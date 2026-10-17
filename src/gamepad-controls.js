/* Standard Gamepad API monitor and local bindings. The diagram never executes work actions. */
(() => {
  const buttons = [
    ['A',77,59,'face'], ['B',85,47,'face'], ['X',69,47,'face'], ['Y',77,35,'face'],
    ['LB',25,20,'shoulder'], ['RB',75,20,'shoulder'], ['LT',25,8,'trigger'], ['RT',75,8,'trigger'],
    ['View',45,40,'menu'], ['Start',55,40,'menu'], ['L3',27,44,'stick'], ['R3',62,69,'stick'],
    ['↑',40,59,'direction'], ['↓',40,78,'direction'], ['←',34,68.5,'direction'], ['→',46,68.5,'direction'], ['◎',50,24,'home']
  ];
  const actions = {
    confirm:['确认 / 单击','确认高亮对象或指针下的控件；输入框只聚焦，只有明确选中发送按钮才发送。'],
    back:['返回 / 取消','关闭当前键盘、窗口或指针模式；保留草稿，不中断任务。'],
    interrupt:['中断任务','向当前任务发送中断请求。'],
    approvals:['查看待确认','打开 Codex 的待确认请求列表。'],
    previous:['上一个任务','切换到列表中的上一个任务。'],
    next:['下一个任务','切换到列表中的下一个任务。'],
    voice:['持续语音','短按开始，再按结束；无需按住，文字只进入草稿。'],
    newThread:['新建任务','打开新任务窗口，选择工作目录。'],
    intent:['意图轮盘','按住后用左摇杆选创作意图，松开只加入草稿；回中或返回取消。'],
    overview:['任务速览','打开可搜索的任务卡片，用左摇杆穿梭，确认进入任务。'],
    focus:['专注模式','收起侧栏与大标题，把空间留给内容；再次按下恢复。'],
    anchor:['阅读锚点','首次标记当前位置，再次按下在当前位置与锚点之间往返。'],
    workbench:['手柄工作台','打开实时输入面板。系统键仅在浏览器开放时可用。'],
    keyboard:['屏幕键盘','编辑当前文本框；支持选区替换、退格、符号与光标移动，不自动发送。'],
    pointer:['精准指针','在空间焦点与精确指针之间切换；左摇杆移动指针，右摇杆仍用于滚动。']
  };
  const defaults = () => ({version:3, bindings:{confirm:0,back:1,interrupt:null,approvals:null,previous:4,next:5,voice:7,newThread:9,intent:6,overview:8,focus:10,anchor:11,workbench:16,keyboard:2,pointer:3},triggerThreshold:.55,deadzone:.18,scrollSpeed:900});
  const limits = {triggerThreshold:[.15,.9],deadzone:[.05,.4],scrollSpeed:[240,1800]};
  const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  function validate(value) {
    const result = defaults(); if (!value || ![1,2,3].includes(value.version)) return result;
    const binding = value.bindings;
    const keys=Object.keys(actions).slice(0,value.version===1?8:value.version===2?13:15);
    if (binding && keys.every(key => binding[key] === null || Number.isInteger(binding[key]) && (binding[key]>=0&&binding[key]<=11||value.version>=2&&binding[key]===16))) {
      const assigned = keys.map(key => binding[key]).filter(key => key !== null);
      if (new Set(assigned).size === assigned.length) {
        for(const key of keys)result.bindings[key]=binding[key];
        // Preserve old remaps; only enable new gestures on previously unused buttons.
        for(const key of Object.keys(actions).filter(key=>!keys.includes(key)))if(assigned.includes(result.bindings[key]))result.bindings[key]=null;
        if(value.version<3){
          // Upgrade only the old default face-button roles; preserve actual remaps and tuning.
          if(result.bindings.interrupt===2){result.bindings.interrupt=null;result.bindings.keyboard=2;}
          if(result.bindings.approvals===3){result.bindings.approvals=null;result.bindings.pointer=3;}
        }
      }
    }
    for (const [key,[min,max]] of Object.entries(limits)) if (finite(value[key],min,max)) result[key] = value[key];
    return result;
  }
  window.ControllerGamepad = class ControllerGamepad {
    constructor(document, {onOpen=()=>{},onClose=()=>{},onSettings=()=>{}}={}) {
      this.document=document; this.$=id=>document.getElementById(id);
      Object.assign(this,{onOpen,onClose,onSettings}); this.selected=7; this.cache=new Map(); this.lastPressed=[]; this.nodes=[];
      this.storageKey='codex-controller.gamepad.v1';
      try { this.config=validate(JSON.parse(window.localStorage.getItem(this.storageKey))); } catch { this.config=defaults(); }
      const create=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
      buttons.forEach(([label,x,y,kind],index)=>{
        const button=create('button',kind==='stick'?null:label,`pad-key pad-${kind}`);button.type='button';button.dataset.button=String(index);
        button.style.setProperty('--x',`${x}%`);button.style.setProperty('--y',`${y}%`);
        let cap;
        if(kind==='stick'){cap=create('span',null,'pad-stick-cap');button.append(cap,create('span',label,'pad-stick-label'));}
        button.onclick=()=>this.select(index);this.$('padButtons').append(button);this.nodes.push({button,cap});
      });
      this.$('padBinding').append(create('option','不分配功能'));
      this.$('padBinding').lastChild.value='none';
      for(const [key,[label]] of Object.entries(actions)){
        const option=create('option',label);option.value=key;this.$('padBinding').append(option);
        const row=create('button',null,'pad-assignment');row.type='button';row.dataset.action=key;
        const name=create('span',label),keycap=create('kbd');row.append(name,keycap);
        row.onclick=()=>{const index=this.config.bindings[key];if(index!=null)this.select(index);};
        this.$('padAssignments').append(row);
        (this.assignments||=new Map()).set(key,{row,keycap});
      }
      this.$('padBinding').onchange=()=>this.bind(this.$('padBinding').value);
      for(const key of Object.keys(limits))this.$(`pad-${key}`).oninput=()=>{
        const next=Number(this.$(`pad-${key}`).value),[min,max]=limits[key];
        if(!finite(next,min,max))return;this.config[key]=next;this.changed('灵敏度已更新');
      };
      this.$('padReset').onclick=()=>{this.config=defaults();this.changed('已恢复默认布局与灵敏度');};
      this.$('padClose').onclick=this.$('padDone').onclick=()=>this.close();
      this.$('controllerPanel').addEventListener('close',()=>{this.$('padStatus').setAttribute('aria-expanded','false');this.onClose();});
      this.renderSettings();this.renderConnection(null);this.select(7);
    }
    text(id,value){if(this.cache.get(id)!==value){this.cache.set(id,value);this.$(id).textContent=value;}}
    meter(id,value){const element=this.$(id);if(Number(element.value)!==value)element.value=value;}
    key(action){const index=this.config.bindings[action];return index==null?'—':buttons[index][0];}
    actionAt(index){return Object.keys(actions).find(key=>this.config.bindings[key]===index);}
    open(){this.onOpen();this.$('controllerPanel').showModal();this.$('padStatus').setAttribute('aria-expanded','true');this.update(this.lastPad);}
    close(){this.$('controllerPanel').close();}
    isOpen(){return !!this.$('controllerPanel').open;}
    select(index){
      this.selected=index;const action=this.actionAt(index),fixed=index>=12&&index<=15;
      this.text('padSelectedKey',buttons[index][0]);this.text('padSelectedTitle',action?actions[action][0]:fixed?'系统 / 导航按键':'未分配功能');
      this.text('padSelectedDescription',action?actions[action][1]:fixed?({12:'上一段：跳到前一条消息或工具记录。',13:'下一段：跳到后一条消息或工具记录。',14:'收起当前记录的执行详情。',15:'展开当前记录的执行详情。'})[index]:'可以为这个按键分配一个工作台功能。');
      this.$('padBinding').disabled=fixed;this.$('padBinding').value=action||'none';
      this.nodes.forEach(({button},i)=>{button.classList.toggle('pad-selected',i===index);button.setAttribute('aria-pressed',String(i===index));});
      if(this.isOpen())this.renderInput(this.lastPad);
    }
    bind(action){
      if(this.selected>=12&&this.selected<=15||action!=='none'&&!Object.hasOwn(actions,action))return;
      const old=this.actionAt(this.selected);if(old===action||!old&&action==='none')return;
      const previous=action==='none'?null:this.config.bindings[action];
      if(old)this.config.bindings[old]=previous;
      if(action!=='none')this.config.bindings[action]=this.selected;
      this.changed(previous!=null&&previous!==this.selected?`已与 ${buttons[previous][0]} 交换功能`:'按键分配已更新');
    }
    changed(message){
      this.renderSettings();this.select(this.selected);this.onSettings();
      try{window.localStorage.setItem(this.storageKey,JSON.stringify(this.config));this.text('padSaveStatus',`${message} · 已保存在此浏览器`);}
      catch{this.text('padSaveStatus',`${message} · 本次会话有效，浏览器未保存设置`);}
    }
    renderSettings(){
      for(const key of Object.keys(limits)){
        this.$(`pad-${key}`).value=String(this.config[key]);
        this.text(`pad-${key}-value`,key==='scrollSpeed'?`${this.config[key]} px / 秒`:`${Math.round(this.config[key]*100)}%`);
      }
      for(const [action,{row,keycap}] of this.assignments){keycap.textContent=this.key(action);row.disabled=this.config.bindings[action]==null;}
      this.nodes.forEach(({button},index)=>{const action=this.actionAt(index);button.setAttribute('aria-label',`${buttons[index][0]} · ${action?actions[action][0]:index>=12?'导航 / 系统':'未分配'}`);button.title=`${buttons[index][0]} · ${action?actions[action][0]:'未分配工作台功能'}`;});
    }
    renderConnection(pad){
      this.text('padDevice',pad?String(pad.id||'已连接手柄').slice(0,160):'等待你的手柄');
      this.text('padConnection',pad?'手柄已连接':'未连接');
      this.text('padMapping',pad?pad.mapping==='standard'?`标准映射 · ${pad.buttons.length} 个按键 · ${pad.axes.length} 个轴`:'非标准映射 · 仅显示输入，工作快捷键暂停':'连接 USB 或蓝牙手柄，保持页面前台并按一下任意键唤醒。');
      for(const id of ['padConnection','padStage'])if(this.$(id).dataset.connected!==String(!!pad))this.$(id).dataset.connected=String(!!pad);
    }
    update(pad){
      this.lastPad=pad||null;
      if(!this.isOpen())return;
      this.renderConnection(pad);this.renderInput(pad);
    }
    renderInput(pad){
      const value=index=>{const b=pad?.buttons?.[index];return finite(b?.value,0,1)?b.value:b?.pressed?1:0;};
      const axis=index=>finite(pad?.axes?.[index],-1,1)?pad.axes[index]:0;
      const pressed=this.nodes.map((_,i)=>value(i)>.5||!!pad?.buttons?.[i]?.pressed);
      const edge=pressed.findIndex((down,i)=>down&&!this.lastPressed[i]);
      if(edge>=0)this.text('padLastInput',`${buttons[edge][0]} · ${this.actionAt(edge)?actions[this.actionAt(edge)][0]:'输入已收到'}`);
      if(!pad)this.text('padLastInput','尚未收到设备输入');this.lastPressed=pressed;
      this.nodes.forEach(({button,cap},i)=>{
        const on=value(i)>.05||pressed[i];if(button.dataset.down!==String(on)){button.dataset.down=String(on);button.classList.toggle('pad-pressed',on);}
        const pressure=`${Math.round(value(i)*100)}%`;if(button.dataset.pressure!==pressure){button.dataset.pressure=pressure;button.style.setProperty('--pressure',pressure);}
        if(cap){const first=i===10?0:2,position=`translate(${(axis(first)*12).toFixed(1)}px,${(axis(first+1)*12).toFixed(1)}px)`;if(cap.style.transform!==position)cap.style.transform=position;}
      });
      for(const [name,index] of [['LT',6],['RT',7]]){this.text(`pad${name}Value`,pad?`${Math.round(value(index)*100)}%`:'—');this.meter(`pad${name}Meter`,value(index));}
      for(const [name,index] of [['Left',0],['Right',2]])this.text(`pad${name}Value`,pad?`X ${axis(index).toFixed(2)} / Y ${axis(index+1).toFixed(2)}`:'X — / Y —');
      this.text('padInputValue',pad?`${Math.round(value(this.selected)*100)}%`:'—');this.meter('padInputMeter',value(this.selected));
    }
  };
})();
