/* Spatial navigation, scoped pointer and native-field editing. Explicit controls execute actions. */
(() => {
  const intents = [
    ['排查问题','先复现，再定位根因','请先复现问题，定位根因并修复，然后补充最小回归测试。','⌕'],
    ['打磨界面','把细节做扎实','请沿用现有设计语言，优化层级、间距、交互状态和可访问性，并检查窄屏布局。','◇'],
    ['补齐测试','覆盖关键路径与边界','请复用现有测试框架，为当前改动补充关键路径和边界回归测试，并运行相关检查。','✓'],
    ['解释实现','讲清真实调用路径','请沿着实际代码说明这部分实现的数据流、关键状态和取舍，不要仅复述文件名。','≋'],
    ['审查变更','找出有证据的问题','请审查当前变更，优先列出可复现的缺陷、风险和缺失测试，引用对应代码位置。','◎'],
    ['分析性能','先测量，再优化','请先测量性能瓶颈，再做最小必要优化，并用相同输入比较优化前后的结果。','↗'],
    ['最小重构','复用、简化、保留行为','请先追踪相关调用，复用已有模式，以最小改动简化实现，并验证原有行为保持一致。','⌘'],
    ['推进下一步','从真实进度继续','请检查当前进度，完成最重要的下一步，并报告实际完成内容与验证结果。','→']
  ];
  const axis = value => Number.isFinite(value) ? Math.max(-1,Math.min(1,value)) : 0;
  const rect = e => e.getBoundingClientRect();
  const interactive = 'button,summary,label,textarea,input,select,a[href],[tabindex="0"]';
  const segments = new Intl.Segmenter('zh-CN',{granularity:'grapheme'});
  window.ControllerPilot = class ControllerPilot {
    constructor(document,{onInsert=()=>{},onWheelOpen=()=>{},onWheelClose=()=>{},onNotice=()=>{}}={}) {
      this.document=document;this.$=id=>document.getElementById(id);Object.assign(this,{onInsert,onWheelOpen,onWheelClose,onNotice});
      this.cache=new Map();this.selectedWheel=null;this.reset();
      this.wheelButtons=intents.map(([title,subtitle,,icon],index)=>{
        const button=document.createElement('button');button.type='button';button.className='intent-choice';
        const angle=index*Math.PI/4;button.style.setProperty('--x',`${50+Math.sin(angle)*36}%`);button.style.setProperty('--y',`${50-Math.cos(angle)*36}%`);
        const symbol=document.createElement('span'),label=document.createElement('strong');symbol.textContent=icon;label.textContent=title;
        button.append(symbol,label);button.title=subtitle;button.setAttribute('aria-pressed','false');button.onclick=()=>this.selectWheel(index);
        this.$('intentChoices').append(button);return button;
      });
      this.$('intentCancel').onclick=()=>this.cancelWheel();this.$('intentCommit').onclick=()=>this.releaseWheel();
      this.$('intentDialog').addEventListener('close',()=>{this.source=null;this.selectedWheel=null;this.reset();this.onWheelClose();});
      this.selectWheel(null);
      this.keyboardHome=this.$('desktopKeyboard').parentElement||document.body;
      this.$('desktopKeyboard').classList.add('hidden');this.$('pilotCursor').classList.add('hidden');
      this.buildKeyboard();this.syncDesktop();
      this.$('keyboardClose').onclick=()=>this.closeKeyboard();
      document.addEventListener('input',e=>{if(e.target===this.keyboardTarget)this.renderKeyboard();});
      document.addEventListener('selectionchange',()=>{if(this.isKeyboardOpen())this.renderKeyboard();});
      document.addEventListener('focusin',e=>{
        if(this.editable(e.target)){this.lastEditor=e.target;if(this.isKeyboardOpen())this.setKeyboardTarget(e.target);}
        this.syncDesktop();
      });
      document.addEventListener('pointerdown',e=>{
        if(e.isTrusted&&!this.$('pointerToggle').contains(e.target))this.setPointer(false);
        if(!this.isKeyboardOpen()||this.$('desktopKeyboard').contains(e.target))return;
        if(this.editable(e.target))this.setKeyboardTarget(e.target);else this.closeKeyboard(false);
      });
      document.addEventListener('keydown',e=>{if(e.isTrusted&&this.pointerMode&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!['Alt','Control','Shift','Meta'].includes(e.key)&&!this.$('pointerToggle').contains(e.target))this.setPointer(false);});
      this.$('desktopKeyboard').addEventListener('keydown',e=>{
        if(e.isComposing||e.key==='Process'||e.keyCode===229){this.closeKeyboard();return;}
        if(e.key==='Escape'){e.preventDefault();this.closeKeyboard();return;}
        if(e.ctrlKey||e.metaKey||e.key==='Tab'){this.closeKeyboard();return;}
        const vectors={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
        if(vectors[e.key]){e.preventDefault();this.navigate(this.$('desktopKeyboard'),vectors[e.key]);}
        else if(!e.altKey&&(e.key.length===1||e.key==='Backspace'||e.key==='Delete')){
          e.preventDefault();this.keyInput(e.key==='Backspace'?'backspace':e.key==='Delete'?'delete':'text',e.key);
        }
      });
    }
    text(id,text){if(this.cache.get(id)!==text){this.cache.set(id,text);this.$(id).textContent=text;}}
    reset(){this.vx=0;this.vy=0;this.coastX=0;this.coastY=0;this.navDirection=null;this.navNext=0;}
    isWheelOpen(){return !!this.$('intentDialog').open;}
    openWheel(source='pointer'){
      if(this.isWheelOpen())return;this.onWheelOpen();this.source=source;this.selectWheel(null);this.reset();this.$('intentDialog').showModal();
      this.text('intentGesture',source==='gamepad'?'保持意图键 · 左摇杆选择 · 松开加入草稿':'选择一个意图，再加入草稿 · 不会自动发送');
    }
    selectWheel(index){
      this.selectedWheel=index;
      this.wheelButtons.forEach((button,i)=>{button.classList.toggle('selected',i===index);button.setAttribute('aria-pressed',String(i===index));});
      const choice=index==null?null:intents[index];
      this.text('intentTitle',choice?.[0]||'你想怎样推进？');this.text('intentSubtitle',choice?.[1]||'推向一个方向，选择创作意图');
      this.text('intentPreview',choice?.[2]||'这里会预览将加入草稿的要求。原有文字会完整保留。');this.$('intentCommit').disabled=!choice;
    }
    wheelVector(x,y){
      x=axis(x);y=axis(y);const magnitude=Math.hypot(x,y);
      if(magnitude<.3){if(this.selectedWheel!==null)this.selectWheel(null);return;}
      if(magnitude<.58)return;
      const angle=(Math.atan2(y,x)+Math.PI/2+2*Math.PI)%(2*Math.PI),index=Math.round(angle/(Math.PI/4))%8;
      if(this.selectedWheel!=null){const difference=Math.atan2(Math.sin(angle-this.selectedWheel*Math.PI/4),Math.cos(angle-this.selectedWheel*Math.PI/4));if(Math.abs(difference)<Math.PI/8+.08)return;}
      if(index!==this.selectedWheel)this.selectWheel(index);
    }
    releaseWheel(){
      if(!this.isWheelOpen())return;const choice=this.selectedWheel==null?null:intents[this.selectedWheel];
      this.$('intentDialog').close();if(choice)this.onInsert({title:choice[0],text:choice[2]});
    }
    cancelWheel(){if(this.isWheelOpen()){this.selectWheel(null);this.$('intentDialog').close();}}
    editable(element){return !!element&&!element.disabled&&!element.readOnly&&element.isConnected!==false&&
      (element.tagName==='TEXTAREA'||element.tagName==='INPUT'&&['text','search','url','tel','password',''].includes(element.type))&&typeof element.selectionStart==='number';}
    isKeyboardOpen(){return !this.$('desktopKeyboard').classList.contains('hidden');}
    setKeyboardTarget(target){
      this.keyboardTarget?.classList.remove('desktop-edit-target');this.keyboardTarget=target;
      target.classList.add('desktop-edit-target');this.renderKeyboard();
    }
    openKeyboard(target){
      if(!this.editable(target)||!target.getClientRects().length){this.onNotice('先选择一个可编辑的文本框');return false;}
      this.setPointer(false);
      const keyboard=this.$('desktopKeyboard'),parent=target.closest('dialog[open]')||this.keyboardHome;
      parent.append(keyboard);keyboard.classList.remove('hidden');this.document.body.classList.add('pilot-keyboard-open');
      this.setKeyboardTarget(target);this.reset();this.focus(this.keyButtons.find(key=>key.base==='q').button);this.syncDesktop();
      this.onNotice('屏幕键盘 · 选键后确认输入，返回只收起，不发送');return true;
    }
    closeKeyboard(restore=true){
      if(!this.isKeyboardOpen())return false;
      const target=this.keyboardTarget;target?.classList.remove('desktop-edit-target');
      this.$('desktopKeyboard').classList.add('hidden');this.keyboardHome.append(this.$('desktopKeyboard'));
      this.document.body.classList.remove('pilot-keyboard-open');this.keyboardTarget=null;this.reset();
      if(restore&&this.editable(target)&&target.getClientRects().length)this.focus(target);
      this.syncDesktop();return true;
    }
    buildKeyboard(){
      this.keyButtons=[];this.caps=false;this.symbols=false;
      const create=(row,label,action,value,kind='')=>{
        const button=this.document.createElement('button');button.type='button';button.className=`desktop-key ${kind}`;
        button.textContent=label;button.setAttribute('aria-label',label);button.onpointerdown=e=>e.preventDefault();
        button.onclick=()=>this.keyInput(action,value);row.append(button);return button;
      };
      for(const letters of ['1234567890','qwertyuiop','asdfghjkl','zxcvbnm']){
        const row=this.document.createElement('div');row.className='desktop-key-row';this.$('keyboardKeys').append(row);
        for(const base of letters){const key={base,button:create(row,base,'text',base)};key.button.onclick=()=>this.keyInput('text',key.value);this.keyButtons.push(key);}
      }
      const row=this.document.createElement('div');row.className='desktop-key-row keyboard-utilities';this.$('keyboardKeys').append(row);
      this.capsButton=create(row,'Aa','caps');this.symbolButton=create(row,'#+=','symbols');
      create(row,'←','left');create(row,'空格','text',' ','key-space');create(row,'→','right');create(row,'退格','backspace');create(row,'换行','enter');
      const tools=this.$('keyboardTools');create(tools,'全选','select');create(tools,'行首','home');create(tools,'行尾','end');
      this.renderKeyCaps();
    }
    renderKeyCaps(){
      const symbols=[...'!@#$%^&*()[]{}<>/\\|_-+=:;\'"`~.,?'];
      this.keyButtons.forEach((key,index)=>{key.value=this.symbols?symbols[index%symbols.length]:this.caps?key.base.toUpperCase():key.base;
        key.button.textContent=key.value;key.button.setAttribute('aria-label',key.value);
      });
      this.capsButton.setAttribute('aria-pressed',String(this.caps));this.symbolButton.setAttribute('aria-pressed',String(this.symbols));
    }
    renderKeyboard(){
      const target=this.keyboardTarget;if(!target)return;
      const start=target.selectionStart,end=target.selectionEnd;
      const secret=target.type==='password';
      this.text('keyboardTarget',secret?'正在编辑：密码字段':`正在编辑：${target.getAttribute('aria-label')||target.labels?.[0]?.textContent||target.placeholder||'文本框'}`);
      this.text('keyboardSelection',secret?'受保护字段':start===end?`光标 ${start} / ${target.value.length}`:`已选 ${end-start} 个字符`);
      const preview=this.$('keyboardPreview');preview.replaceChildren();
      for(const [text,cls]of secret?[['••••••','']]:[[target.value.slice(Math.max(0,start-45),start),''],[target.value.slice(start,Math.min(end,start+90))+(end-start>90?'…':'')||'│','keyboard-caret'],[target.value.slice(end,end+45),'']]){
        const span=this.document.createElement('span');span.textContent=text;span.className=cls;preview.append(span);
      }
    }
    keyInput(action,text=''){
      const target=this.keyboardTarget;
      if(!this.isKeyboardOpen()||!this.editable(target)||!target.getClientRects().length){this.closeKeyboard(false);return false;}
      if(action==='caps'||action==='symbols'){this[action==='caps'?'caps':'symbols']=!this[action==='caps'?'caps':'symbols'];this.renderKeyCaps();return true;}
      let start=target.selectionStart,end=target.selectionEnd;
      const boundaries=['left','right','backspace','delete'].includes(action)?[0,...[...segments.segment(target.value)].map(part=>part.index+part.segment.length)]:[];
      if(action==='select'){target.setSelectionRange(0,target.value.length);this.renderKeyboard();return true;}
      if(['left','right','home','end'].includes(action)){
        const at=action==='home'?0:action==='end'?target.value.length:action==='left'?start!==end?start:boundaries.filter(n=>n<start).at(-1)??0:start!==end?end:boundaries.find(n=>n>end)??target.value.length;
        target.setSelectionRange(at,at);this.renderKeyboard();return true;
      }
      if(action==='enter'){if(target.tagName!=='TEXTAREA'){this.closeKeyboard();return true;}text='\n';}
      if(action==='backspace'||action==='delete'){
        text='';if(start===end){if(action==='backspace')start=boundaries.filter(n=>n<start).at(-1)??0;else end=boundaries.find(n=>n>end)??target.value.length;}
      }
      if(target.maxLength>=0&&target.value.length-(end-start)+text.length>target.maxLength){this.onNotice('已达到文本框的长度上限');return false;}
      target.setRangeText(text,start,end,'end');target.dispatchEvent(new Event('input',{bubbles:true}));this.renderKeyboard();return true;
    }
    setPointer(enabled,root=this.document){
      this.pointerMode=!!enabled;this.pointerTarget?.classList.remove('pilot-pointer-target');this.pointerTarget=null;
      this.$('pilotCursor').classList.toggle('hidden',!enabled);this.reset();
      if(enabled){
        const current=this.document.activeElement,box=current&&current.getClientRects().length?rect(current):{left:window.innerWidth/2,top:window.innerHeight/2,width:0,height:0};
        this.pointerX=box.left+box.width/2;this.pointerY=box.top+box.height/2;this.movePointer(0,0,0,.18,root);
        this.onNotice('精准指针 · 左摇杆轻推微调，确认单击；右摇杆仍可滚动');
      }
      this.syncDesktop();
    }
    movePointer(x,y,seconds,deadzone,root=this.document){
      if(!this.pointerMode)return;
      x=axis(x);y=axis(y);const length=Math.hypot(x,y),speed=length>deadzone?((Math.min(1,length)-deadzone)/(1-deadzone))**1.8*720*Math.max(0,Math.min(.05,seconds))/length:0;
      this.pointerX=Math.max(8,Math.min(window.innerWidth-8,this.pointerX+x*speed));this.pointerY=Math.max(8,Math.min(window.innerHeight-8,this.pointerY+y*speed));
      const cursor=this.$('pilotCursor'),parent=root===this.document?this.document.body:root;
      if(cursor.parentElement!==parent)parent.append(cursor);
      cursor.style.transform=`translate(${this.pointerX.toFixed(1)}px,${this.pointerY.toFixed(1)}px)`;
      const target=this.pointerHit(root);if(target!==this.pointerTarget){this.pointerTarget?.classList.remove('pilot-pointer-target');this.pointerTarget=target;target?.classList.add('pilot-pointer-target');}
      this.text('pilotFocusLabel',target?(target.getAttribute('aria-label')||target.title||target.textContent||'输入框').trim().slice(0,28):'移动指针到可操作对象');
    }
    pointerHit(root){
      const element=this.document.elementFromPoint(this.pointerX,this.pointerY)?.closest(interactive);
      return this.canActivate(element,root)?element:null;
    }
    canActivate(element,root=this.document){return !!element&&element.matches(interactive)&&!element.disabled&&element.isConnected!==false&&element.getAttribute('aria-disabled')!=='true'&&element.getClientRects().length>0&&(root===this.document||root.contains(element));}
    activate(element,root=this.document){
      if(!this.canActivate(element,root))return false;
      if(['BUTTON','A','SUMMARY','LABEL'].includes(element.tagName)||element.tagName==='INPUT'&&['checkbox','radio'].includes(element.type))element.click();
      else{this.focus(element);this.onNotice(this.editable(element)?'输入框已聚焦 · 输入键打开屏幕键盘；选中发送按钮后才发送':'控件已聚焦 · 方向键调整，摇杆切换对象');}
      return true;
    }
    suspendDesktop(){this.setPointer(false);this.closeKeyboard(false);}
    syncDesktop(){
      this.$('keyboardToggle').setAttribute('aria-pressed',String(this.isKeyboardOpen()));this.$('pointerToggle').setAttribute('aria-pressed',String(!!this.pointerMode));
      this.text('keyboardToggleLabel',this.isKeyboardOpen()?'收起键盘':'屏幕键盘');this.text('pointerToggleLabel',this.pointerMode?'焦点导航':'精准指针');
      this.text('faceConfirmLabel',this.pointerMode?'单击目标':this.isKeyboardOpen()?'输入选中键':'确认焦点');
      this.text('pilotLeftMode',this.pointerMode?'左摇杆 · 精准指针':'左摇杆 · 空间穿梭');
    }
    navigation(x,y,now,deadzone=.18){
      x=axis(x);y=axis(y);const magnitude=Math.hypot(x,y);
      if(magnitude<Math.max(.26,deadzone)){this.navDirection=null;return null;}
      if(magnitude<Math.max(.55,deadzone))return null;
      const angle=Math.atan2(y,x);let direction=(Math.round(angle/(Math.PI/4))+8)%8;
      if(this.navDirection!=null){const difference=Math.atan2(Math.sin(angle-this.navDirection*Math.PI/4),Math.cos(angle-this.navDirection*Math.PI/4));if(Math.abs(difference)<Math.PI/8+.1)direction=this.navDirection;}
      if(this.navDirection===direction&&now<this.navNext)return null;
      const changed=this.navDirection!==direction;this.navDirection=direction;
      this.navNext=now+(changed?330:magnitude>.85?130:210);
      return [Math.cos(direction*Math.PI/4),Math.sin(direction*Math.PI/4)];
    }
    focus(element){
      this.focused?.classList.remove('pilot-target');this.focused=element;element.classList.add('pilot-target');
      element.focus({preventScroll:true});this.reveal(element);
      this.text('pilotFocusLabel',(element.getAttribute('aria-label')||element.title||element.textContent||'输入区').trim().slice(0,28));
    }
    reveal(element){
      let parent=element.parentElement;
      for(let depth=0;parent&&depth<20;depth++,parent=parent.parentElement){
        if(parent.clientHeight&&parent.scrollHeight>parent.clientHeight){const r=rect(element),p=rect(parent);if(r.top<p.top+10)parent.scrollTop+=r.top-p.top-10;else if(r.bottom>p.bottom-10)parent.scrollTop+=r.bottom-p.bottom+10;}
      }
    }
    navigate(root,vector){
      // ponytail: O(n) visible focus candidates per snap; index only if workspaces reach thousands of controls.
      const items=[...root.querySelectorAll('button:not(:disabled),summary,textarea,input,select,a[href],[tabindex="0"]')].filter(e=>!e.disabled&&e.getClientRects().length&&rect(e).width>0&&rect(e).height>0);
      if(!items.length)return false;
      const active=this.document.activeElement,current=items.includes(active)?active:null;
      if(!current){this.focus(items[0]);return true;}
      const a=rect(current),origin=[a.left+a.width/2,a.top+a.height/2];let best=null,score=Infinity;
      for(const item of items){
        if(item===current)continue;const b=rect(item),dx=b.left+b.width/2-origin[0],dy=b.top+b.height/2-origin[1];
        const along=dx*vector[0]+dy*vector[1];if(along<6)continue;
        const across=Math.abs(dx*vector[1]-dy*vector[0]),candidate=Math.hypot(dx,dy)+across*2;
        if(candidate<score){best=item;score=candidate;}
      }
      if(best)this.focus(best);return !!best;
    }
    motion(x,y,seconds,deadzone,speed){
      const dt=Math.max(0,Math.min(.05,seconds)),decayRate=18;
      const integrate=(value,key,coastKey)=>{
        value=axis(value);const magnitude=Math.abs(value),target=magnitude>deadzone?Math.sign(value)*((magnitude-deadzone)/(1-deadzone))**1.7*speed:0;
        let slice=dt;if(target){this[coastKey]=0;}else{slice=Math.min(dt,Math.max(0,.18-this[coastKey]));this[coastKey]+=dt;}
        const decay=Math.exp(-decayRate*slice),old=this[key],distance=target*slice+(old-target)*(1-decay)/decayRate;
        this[key]=target+(old-target)*decay;if(!target&&this[coastKey]>=.18)this[key]=0;
        return distance;
      };
      return [integrate(x,'vx','coastX'),integrate(y,'vy','coastY')];
    }
    dock(axes=[]){
      for(const [id,index]of [['pilotLeftStick',0],['pilotRightStick',2]]){
        const position=`translate(${Math.round(axis(axes[index])*6)}px,${Math.round(axis(axes[index+1])*6)}px)`;
        if(this.$(id).style.transform!==position)this.$(id).style.transform=position;
      }
    }
  };
})();
