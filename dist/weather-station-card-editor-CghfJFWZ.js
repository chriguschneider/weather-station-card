import{b as e,f as t,A as o,n as a,r as i,a as n,t as s,h as r,i as l,c,d,e as h,s as u,v as _,p,g as m,j as f,k as g,C as v,l as y,D as b,m as w,o as $}from"./main-ZAMKtix7.js";const x=e=>"number"==typeof e&&Number.isFinite(e),k=e=>"string"==typeof e&&""!==e?e:void 0;async function C(e){const t=await fetch(e);if(!t.ok)throw new Error(`HTTP ${t.status}`);return await t.json()}const z=[{name:"weather_entity",required:!0,selector:{entity:{domain:"weather"}}}];function L(t){const{editor:o,sectionKey:a,icon:i,title:n,summary:s,resetLabel:r,body:l}=t;return e`
    <ha-expansion-panel
      outlined
      class="editor-panel"
      .expanded=${o._isPanelExpanded(a)}
      @expanded-changed=${e=>o._setPanelExpanded(a,!0===e.detail?.expanded)}
    >
      <div slot="header" class="panel-header">
        <ha-icon class="panel-icon" .icon=${i}></ha-icon>
        <div class="panel-titles">
          <div class="panel-title">${n}</div>
          <div class="panel-summary">${s}</div>
        </div>
        <ha-icon-button
          class="panel-reset"
          title=${r}
          aria-label=${r}
          @click=${e=>{e.stopPropagation(),o._resetSection(a)}}
        ><ha-icon icon="mdi:restore"></ha-icon></ha-icon-button>
      </div>
      <div class="panel-body">${l}</div>
    </ha-expansion-panel>
  `}const S=new Set(["temperature"]);function U(e){const o=e?.states?Object.entries(e.states).filter(([,e])=>!!e):[],a=e=>o.filter(([t,o])=>t.startsWith("sensor.")&&e.includes(o.attributes?.device_class||"")).map(([e])=>e),i=o.filter(([e,t])=>e.startsWith("sensor.")&&("°"===t.attributes?.unit_of_measurement||"deg"===t.attributes?.unit_of_measurement)).map(([e])=>e),n=/^(mm|in|inch|inches|")\/(h|hr|hour)$/i,s=o.filter(([e,t])=>e.startsWith("sensor.")&&("precipitation_intensity"===t.attributes?.device_class||n.test(t.attributes?.unit_of_measurement||""))).map(([e])=>e),r=/zero[._ -]?degree|freezing[._ -]?level|nullgrad|snow[._ -]?line/i,l=o.filter(([e,t])=>e.startsWith("sensor.")&&(r.test(e)||r.test(t.attributes?.friendly_name||""))).map(([e])=>e),c=/next[._ -]?rain|n[aä]chster[._ -]?regen/i,d=t(e),h=o.filter(([e,t])=>e.startsWith("sensor.")&&(e===d||c.test(e)||c.test(t.attributes?.friendly_name||""))).map(([e])=>e),u=/(?:^|[._-])uv(?:[._-]|index|$)/i,_=/\buv[\s_-]?index\b|\buv\b/i,p=o.filter(([e,t])=>{if(!e.startsWith("sensor."))return!1;const o=t.attributes?.friendly_name||"";return u.test(e)||_.test(o)}).map(([e])=>e);return[{key:"temperature",candidates:a(["temperature"])},{key:"pressure",candidates:a(["atmospheric_pressure","pressure"])},{key:"humidity",candidates:a(["humidity"])},{key:"dew_point",candidates:a(["temperature"])},{key:"precipitation",candidates:a(["precipitation"])},{key:"precipitation_rate",candidates:s},{key:"wind_speed",candidates:a(["wind_speed","speed"])},{key:"gust_speed",candidates:a(["wind_speed","speed"])},{key:"wind_direction",candidates:i},{key:"illuminance",candidates:a(["illuminance","irradiance"])},{key:"uv_index",candidates:p},{key:"sunshine_duration",candidates:[]},{key:"zero_degree_level",candidates:l},{key:"zero_degree_level_48h",candidates:l},{key:"next_rain",candidates:h}]}function q(t){const{label:o,options:a,selected:i,onChange:n,group:s}=t,r=new Set(i);return e`
    <div class="pill-field">
      ${o?e`<div class="pill-label">${o}</div>`:""}
      <div class="pills" data-group=${s}>
        ${a.map(t=>{const o=r.has(t.value);return e`
            <button
              type="button"
              class="pill ${o?"on":""}"
              role="switch"
              aria-checked=${o?"true":"false"}
              data-value=${t.value}
              @click=${()=>(e=>{const t=new Set(r);t.has(e)?t.delete(e):t.add(e),n(a.map(e=>e.value).filter(e=>t.has(e)))})(t.value)}
            >${t.label}</button>
          `})}
      </div>
    </div>
  `}const A=[{path:"forecast.condition_icons",def:!0,labelKey:"show_chart_icons"},{path:"forecast.show_wind_arrow",def:!0,labelKey:"show_chart_wind_direction"},{path:"forecast.show_wind_speed",def:!0,labelKey:"show_chart_wind_speed"},{path:"forecast.show_date",def:!0,labelKey:"show_chart_date"},{path:"forecast.show_sunshine",def:!1,labelKey:"show_chart_sunshine"},{path:"forecast.show_precip_probability",def:!1,labelKey:"show_chart_precip_probability"},{path:"forecast.show_mode_toggle",def:!0,labelKey:"show_chart_mode_toggle"}],O=e=>e.split(".").pop();function K(e,t,o){const a=e.map(e=>e.filter(e=>e!==t));for(;a.length<=o.column;)a.push([]);const i=a[o.column];return i.splice(Math.max(0,Math.min(o.index,i.length)),0,t),a}function P(e,t,o){return e<t?t-e:e>o?e-o:0}const j={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right"};let N=null;function F(e,t){return JSON.stringify(e)===JSON.stringify(t)}function T(e){const t=N;if(!t)return;window.removeEventListener("pointermove",t.onMove),window.removeEventListener("pointerup",t.onUp),window.removeEventListener("pointercancel",t.onCancel),t.ghost?.remove(),N=null;const o=t.active&&!F(a(t.preview),a(t.base));e&&o?t.onChange(a(t.preview)):t.rerender()}function E(e,t){if(0!==e.button)return;N&&T(!1);const o=e.currentTarget,a=o.closest(".layout-board");if(!a)return;const i=o.getBoundingClientRect(),n={token:t.token,board:a,startX:e.clientX,startY:e.clientY,grabOffsetX:e.clientX-i.left,grabOffsetY:e.clientY-i.top,pillWidth:i.width,pillHeight:i.height,label:t.label,active:!1,base:t.layout,preview:t.layout,ghost:null,onChange:t.onChange,rerender:t.rerender,onMove:e=>{const t=N;if(!t)return;if(!t.active){const o=e.clientX-t.startX,a=e.clientY-t.startY;if(o*o+a*a<36)return;t.active=!0,t.ghost=function(e){const t=document.createElement("div");return t.textContent=e.label,t.setAttribute("aria-hidden","true"),Object.assign(t.style,{position:"fixed",left:"0",top:"0",width:`${e.pillWidth}px`,boxSizing:"border-box",padding:"7px 14px",borderRadius:"16px",fontSize:"13px",lineHeight:"1.2",fontFamily:"inherit",background:"var(--primary-color, #03a9f4)",color:"var(--text-primary-color, #fff)",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.3)",pointerEvents:"none",zIndex:"10000",opacity:"0.9"}),document.body.appendChild(t),t}(t),t.rerender()}e.preventDefault(),function(e,t,o){e.ghost&&(e.ghost.style.transform=`translate(${t-e.grabOffsetX}px, ${o-e.grabOffsetY}px)`)}(t,e.clientX,e.clientY);const o=function(e,t,o){if(0===t.length)return null;let a=0,i=1/0;t.forEach((t,o)=>{const n=function(e,t,o){const a=P(e,o.left,o.right),i=P(t,o.top,o.bottom);return a*a+i*i}(e.x,e.y,t.rect);n<i&&(i=n,a=o)});const n=t[a].pills.filter(e=>e.token!==o).filter(t=>(t.rect.top+t.rect.bottom)/2<e.y).length;return{column:a,index:n}}({x:e.clientX,y:e.clientY},function(e){return Array.from(e.querySelectorAll("[data-col]")).map(e=>({rect:e.getBoundingClientRect(),pills:Array.from(e.querySelectorAll("[data-token]")).map(e=>({token:e.dataset.token,rect:e.getBoundingClientRect()}))}))}(t.board),t.token);if(!o)return;const a=K(t.base,t.token,o);F(a,t.preview)||(t.preview=a,t.rerender())},onUp:()=>T(!0),onCancel:()=>T(!1)};N=n,window.addEventListener("pointermove",n.onMove),window.addEventListener("pointerup",n.onUp),window.addEventListener("pointercancel",n.onCancel)}function M(t){const{layout:i,explicit:n,labelFor:s,t:r,onChange:l,onReset:c,rerender:d}=t,h=N?.active?N.preview:i,u=N?.active?N.token:null,_=t=>e`
    <div
      class="pill on layout-pill ${t===u?"dragging":""}"
      data-token=${t}
      tabindex="0"
      role="option"
      aria-label=${s(t)}
      @pointerdown=${e=>E(e,{token:t,label:s(t),layout:i,onChange:l,rerender:d})}
      @keydown=${e=>((e,t)=>{const o=j[e.key];if(!o)return;e.preventDefault();const n=function(e,t,o){const i=e.findIndex(e=>e.includes(t));if(i<0)return e;const n=e[i].indexOf(t);let s;switch(o){case"up":if(0===n)return e;s={column:i,index:n-1};break;case"down":if(n>=e[i].length-1)return e;s={column:i,index:n+1};break;case"left":if(0===i)return e;s={column:i-1,index:Math.min(n,e[i-1].length)};break;case"right":if(i===e.length-1&&1===e[i].length)return e;s={column:i+1,index:Math.min(n,e[i+1]?.length??0)}}return a(K(e,t,s))}(i,t,o);if(n===i)return;l(n);const s=e.currentTarget.closest(".layout-board");requestAnimationFrame(()=>{s?.querySelector(`[data-token="${t}"]`)?.focus()})})(e,t)}
    ><ha-icon icon="mdi:drag-vertical"></ha-icon><span>${s(t)}</span></div>
  `;return e`
    <div class="pill-field">
      <div class="pill-label">${r("layout_board_label")}</div>
      <div class="layout-board" role="listbox" aria-label=${r("layout_board_label")}>
        ${h.map((t,o)=>e`
          <div class="layout-col ${0===t.length?"empty":""}" data-col=${o}>
            ${t.map(_)}
          </div>
        `)}
        <div class="layout-col new" data-col=${h.length}>
          <span>${r("layout_board_new_column")}</span>
        </div>
      </div>
      <div class="hint">${r("layout_board_hint")}</div>
      ${n?e`
        <button type="button" class="link-button" @click=${c}>${r("layout_board_reset")}</button>
      `:o}
    </div>
  `}const D=[{path:"show_temperature",def:!0},{path:"show_current_condition",def:!1},{path:"show_day",def:!1},{path:"show_date",def:!1}],B=[{path:"show_pressure",def:!0,gate:"live",gateKey:"pressure"},{path:"show_dew_point_humidity",def:!1,gate:"live",gateKey:["dew_point","humidity"],requireAll:!0},{path:"show_dew_point",def:!1,gate:"live",gateKey:"dew_point"},{path:"show_humidity",def:!1,gate:"live",gateKey:"humidity"},{path:"show_precipitation",def:!0,gate:"sensor",gateKey:["precipitation","precipitation_rate"]},{path:"show_next_rain",def:!1,gate:"sensor",gateKey:"next_rain"},{path:"show_zero_degree_level",def:!1,gate:"sensor",gateKey:"zero_degree_level"},{path:"show_zero_degree_level_48h",def:!1,gate:"sensor",gateKey:"zero_degree_level_48h"},{path:"show_uv_illuminance",def:!1,gate:"live",gateKey:["uv_index","illuminance"],requireAll:!0},{path:"show_uv_index",def:!0,gate:"live",gateKey:"uv_index"},{path:"show_illuminance",def:!1,gate:"sensor",gateKey:"illuminance"},{path:"show_wind_direction",def:!0,gate:"live",gateKey:"wind_direction"},{path:"show_wind_speed",def:!0,gate:"live",gateKey:"wind_speed"},{path:"show_wind_gust_speed",def:!1,gate:"live",gateKey:"gust_speed"},{path:"show_sun",def:!1},{path:"show_moon",def:!0}],R=["off","on","on_seconds"],I=["24h","12h"];function J(e,t){return t.filter(({path:t,def:o})=>o?!1!==e[t]:!0===e[t]).map(({path:e})=>e)}function Y(e,t){const o=t.split(".").pop()??t;return"show_dew_point_humidity"===o?`${e("show_dew_point")} + ${e("show_humidity")}`:"show_uv_illuminance"===o?`${e("show_uv_index")} + ${e("show_illuminance")}`:e(o)}const X=[{name:"",type:"grid",schema:[{name:"pressure",selector:{select:{mode:"dropdown",options:["hPa","mmHg","inHg"]}}},{name:"speed",selector:{select:{mode:"dropdown",options:["km/h","m/s","mph","Bft"]}}},{name:"precipitation",selector:{select:{mode:"dropdown",options:["mm","in"]}}}]}],H={basics:["show_station","show_forecast","forecast.type","title","weather_entity"],sensors:["sensors","forecast.openmeteo_history"],chart:["days","forecast_days","forecast.number_of_forecasts","forecast.chart_height","forecast.condition_icons","forecast.show_wind_arrow","forecast.show_wind_speed","forecast.show_date","forecast.show_sunshine","forecast.show_precip_probability","forecast.show_mode_toggle","forecast.style","forecast.round_temp","forecast.disable_animation"],live_panel:["show_main","show_temperature","show_current_condition","show_time","show_time_seconds","use_12hour_format","show_day","show_date","show_attributes","show_humidity","show_pressure","show_dew_point","show_precipitation","show_uv_index","show_illuminance","show_wind_direction","show_wind_speed","show_wind_gust_speed","show_sun","show_moon","show_zero_degree_level","show_zero_degree_level_48h","show_next_rain","show_dew_point_humidity","show_uv_illuminance","attributes_layout"],location:["location","time_zone","elevation"],units:["units"],actions:["tap_action","hold_action","double_tap_action"]};function W(e,t){const o=e?.language||"en",a=o.split("-")[0];for(const e of[o,w(o),a,"en"]){const o=$[e]?.editor;if(o&&"string"==typeof o[t])return o[t]}return t}customElements.define("weather-station-card-editor",class extends l{constructor(){super(...arguments),this.hass=null,this._config=null,this._locUi={query:"",results:[],status:null},this._setPastSource=e=>{if(!this._config)return;const t={...this._config},o={...t.forecast??{}};"openmeteo"===e?(o.openmeteo_history=!0,t.forecast=o,delete t.sensors):(delete o.openmeteo_history,0===Object.keys(o).length?delete t.forecast:t.forecast=o),this.configChanged(t),this.requestUpdate()},this._setClockMode=e=>{const t=[];"off"!==e&&t.push("show_time"),"on_seconds"===e&&t.push("show_time_seconds"),this._applyTogglePaths([{path:"show_time",def:!1},{path:"show_time_seconds",def:!1}],t)},this._setTimeFormat=e=>{this._applyTogglePaths([{path:"use_12hour_format",def:!1}],"12h"===e?["use_12hour_format"]:[])},this._applyTogglePaths=(e,t)=>{if(!this._config)return;const o=new Set(t),a=JSON.parse(JSON.stringify(this._config));for(const{path:t,def:i}of e){const e=t.split(".").pop(),n=o.has(e);n===i?this._deleteByPath(a,t):this._setByPath(a,t,n)}this.configChanged(a),this.requestUpdate()},this._applyAttributeToggles=(e,t)=>{if(!this._config)return;const o=new Set(t),a=JSON.parse(JSON.stringify(this._config));let i=n(this._config);for(const{path:t}of e){const e=s(t);if(!e)continue;const a=t.split(".").pop();i=o.has(a)?c(i,e):d(i,e)}this._setAttributesLayout(i,a)},this._setAttributesLayout=(e,t)=>{if(!this._config)return;const o=t??JSON.parse(JSON.stringify(this._config));if(null===e){const e=new Set(n(this._config).flat());delete o.attributes_layout;for(const t of h){const a=u(t),i=!0===b[a],n=e.has(t);n===i?delete o[a]:o[a]=n}}else{o.attributes_layout=a(e);for(const e of h)delete o[u(e)]}this.configChanged(o),this.requestUpdate()},this._expandedPanels={},this._sensorsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail;this.configChanged({...this._config,sensors:o.value}),this.requestUpdate()},this._sensorPickerChanged=(e,t)=>{if(!this._config)return;const o={...this._config.sensors||{}};""===t||null==t?delete o[e]:o[e]=t,this.configChanged({...this._config,sensors:o}),this.requestUpdate()},this._unitsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail;this.configChanged({...this._config,units:o.value}),this.requestUpdate()},this._chartTopChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail,a={...this._config};for(const[e,t]of Object.entries(o.value))void 0===t||""===t?delete a[e]:a[e]=t;this.configChanged(a),this.requestUpdate()},this._chartForecastChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail,a={...this._config.forecast||{}};for(const[e,t]of Object.entries(o.value))void 0===t||""===t?delete a[e]:a[e]=t;this.configChanged({...this._config,forecast:a}),this.requestUpdate()},this._livePanelChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail,a={...this._config};for(const[e,t]of Object.entries(o.value))void 0===t||""===t?delete a[e]:a[e]=t;this.configChanged(a),this.requestUpdate()},this._locationChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail,a={...this._config.location||{}};for(const[e,t]of Object.entries(o.value))null==t||""===t||"time_zone"===e&&void 0===_(t)?delete a[e]:a[e]=t;const i={...this._config};Object.keys(a).length?i.location=a:delete i.location,this.configChanged(i),this.requestUpdate()},this._timeZoneModeChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail,a=o.value?.time_zone,i={...this._config};a&&"server"!==a?i.time_zone=a:delete i.time_zone,this.configChanged(i),this.requestUpdate()},this._locationSwitchChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=!0===e.detail.value?.use_location,a={...this._config};if(o){const e=this.hass?.config,t=_(e?.time_zone),o={latitude:"number"==typeof e?.latitude?e.latitude:0,longitude:"number"==typeof e?.longitude?e.longitude:0};t&&(o.time_zone=t),a.location=o,a.time_zone="location"}else delete a.location,delete a.time_zone,this._locUi={...this._locUi,results:[],status:null};this.configChanged(a),this.requestUpdate()},this._locationMapChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail.value?.location;"number"==typeof o?.latitude&&"number"==typeof o?.longitude&&this._writeLocation({latitude:o.latitude,longitude:o.longitude})},this._locationQueryChanged=e=>{const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const o=e.detail.value?.query;this._locUi={...this._locUi,query:"string"==typeof o?o:""}},this._locationSearch=async()=>{const e=this._locUi.query.trim();if(!e)return;const t=this.hass?.locale?.language||this.hass?.language||"en";try{const o=await async function(e,t){const o=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(e)}&count=10&language=${encodeURIComponent(t)}&format=json`,a=await C(o),i=Array.isArray(a.results)?a.results:[],n=[];for(const e of i)e&&x(e.latitude)&&x(e.longitude)&&k(e.name)&&n.push({name:e.name,admin1:k(e.admin1),country:k(e.country),latitude:e.latitude,longitude:e.longitude,elevation:x(e.elevation)?e.elevation:void 0,timezone:k(e.timezone)});return n}(e,t);this._locUi={...this._locUi,results:o,status:o.length?null:{kind:"error",text:W(this.hass,"location_search_none")}}}catch{this._locUi={...this._locUi,results:[],status:{kind:"error",text:W(this.hass,"location_search_error")}}}this.requestUpdate()},this._locationPick=e=>{const t={latitude:e.latitude,longitude:e.longitude};void 0!==e.elevation&&(t.elevation=e.elevation),void 0!==_(e.timezone)&&(t.time_zone=e.timezone),this._locUi={...this._locUi,results:[],status:null},this._writeLocation(t)},this._locationDetermine=async()=>{const e=p(this._config?.location);if(!e)return;const t=`${e.latitude.toFixed(2)}, ${e.longitude.toFixed(2)}`;try{const o=await async function(e,t){const o=await C(`https://api.open-meteo.com/v1/forecast?latitude=${e}&longitude=${t}&timezone=auto`),a={};x(o.elevation)&&(a.elevation=o.elevation);const i=k(o.timezone);if(i&&(a.timezone=i),void 0===a.elevation&&void 0===a.timezone)throw new Error("no elevation or time zone in response");return a}(e.latitude,e.longitude),a={};void 0!==o.elevation&&(a.elevation=o.elevation),void 0!==_(o.timezone)&&(a.time_zone=o.timezone),this._locUi={...this._locUi,status:{kind:"ok",text:W(this.hass,"location_determined").replace("{place}",t)}},this._writeLocation(a)}catch{this._locUi={...this._locUi,status:{kind:"error",text:W(this.hass,"location_determine_error")}},this.requestUpdate()}},this._resetSection=e=>{if(!this._config)return;const t=H[e];if(!t)return;const o=JSON.parse(JSON.stringify(this._config));for(const e of t)this._deleteByPath(o,e);this.configChanged(o),this.requestUpdate()},this._valueChanged=(e,t)=>{if(!this._config)return;const o={...this._config},a=e.target.checked??e.target.value;if(t.includes(".")){const e=t.split(".");let i=o;for(let t=0;t<e.length-1;t++)i[e[t]]={...i[e[t]]},i=i[e[t]];i[e[e.length-1]]=a}else o[t]=a;this.configChanged(o),this.requestUpdate()},this._actionChanged=(e,t)=>{if(!this._config)return;const o={...this._config};null==t?delete o[e]:o[e]=t,this.configChanged(o),this.requestUpdate()}}static get properties(){return{_config:{type:Object},hass:{type:Object}}}setConfig(e){if(!e)throw new Error("Invalid configuration");this._config=e;const t=this.hass?.language||"en";"en"!==t&&"en"!==t.split("-")[0]&&m(t).then(()=>this.requestUpdate()),this.requestUpdate()}get config(){return this._config}get _mode(){if(!this._config)return"station";const e=!1!==this._config.show_station,t=!0===this._config.show_forecast;return e&&t?"combination":t?"forecast":"station"}_setMode(e){if(!this._config)return;const t={...this._config};switch(e){case"station":t.show_station=!0,t.show_forecast=!1;break;case"forecast":t.show_station=!1,t.show_forecast=!0;break;case"combination":t.show_station=!0,t.show_forecast=!0}this.configChanged(t),this.requestUpdate()}get _pastSource(){const e=this._config?.sensors||{};if(Object.values(e).some(e=>"string"==typeof e&&""!==e.trim()))return"station";const t=this._config?.forecast;return!0===t?.openmeteo_history?"openmeteo":"station"}get _clockMode(){const e=this._config??{};return!0!==e.show_time?"off":!0===e.show_time_seconds?"on_seconds":"on"}get _timeFormat(){return!0===this._config?.use_12hour_format?"12h":"24h"}_setByPath(e,t,o){const a=t.split(".");let i=e;for(let e=0;e<a.length-1;e++){const t=i[a[e]];t&&"object"==typeof t||(i[a[e]]={}),i=i[a[e]]}i[a[a.length-1]]=o}_isPanelExpanded(e){return!0===this._expandedPanels[e]}_setPanelExpanded(e,t){this._expandedPanels[e]=t}_pastDataAvailable(){if(!this._config)return!0;const e=this._config.sensors||{},t=Object.values(e).some(e=>"string"==typeof e&&""!==e.trim()),o=this._config.forecast;return t||!0===o?.openmeteo_history}updated(e){e.has("_config")&&this._config&&!this._pastDataAvailable()&&"forecast"!==this._mode&&this._setMode("forecast")}configChanged(e){const t=new Event("config-changed",{bubbles:!0,composed:!0});t.detail={config:e},this.dispatchEvent(t)}_writeLocation(e){if(!this._config)return;const t={...this._config.location||{},...e};this.configChanged({...this._config,location:t}),this.requestUpdate()}_deleteByPath(e,t){const o=t.split("."),a=[e];let i=e;for(let e=0;e<o.length-1;e++){const t=i?.[o[e]];if(!t||"object"!=typeof t)return;i=t,a.push(i)}delete i[o[o.length-1]];for(let e=a.length-1;e>0;e--){const t=a[e];if(!t||0!==Object.keys(t).length)break;delete a[e-1][o[e-1]]}}_renderSunshineAvailabilityHint(t,o){const a=t&&t.forecast;if(!0!==a?.show_sunshine)return"";const i=this.hass,n=f(t,i);if(!n)return"";const s=g(n.latitude,n.longitude,new v(y(t,i?.config?.time_zone).zone));if(!s)return e`<div class="hint" style="margin-top:4px;">
        ${o("sunshine_availability_pending")}
      </div>`;const r=parseInt(String(t.forecast_days??(t.days||7)),10),l=Number.isFinite(r)&&s.forecastDays>0&&r>s.forecastDays,c=(o("sunshine_availability")||"Sunshine: {past} past, {future} forecast days available").replace("{past}",String(s.pastDays)).replace("{future}",String(s.forecastDays));return e`
      <div class="hint" style="margin-top:4px;">
        ${c}
        ${l?e`<br/>${(o("sunshine_availability_warning")||"Configured forecast_days ({req}) exceeds available — last {gap} columns will have empty sunshine bars.").replace("{req}",String(r)).replace("{gap}",String(r-s.forecastDays))}`:""}
      </div>
    `}render(){const t=e=>W(this.hass,e),o=this._config??{},a=o.forecast??{},l=o.sensors??{},c=o.units??{},d=this._mode,h="combination"===d,u="forecast"===d||h,_="station"===d||h,p={humidity:"humidity",pressure:"pressure",dew_point:"dew_point",uv_index:"uv_index",wind_direction:"wind_bearing",wind_speed:"wind_speed",gust_speed:"wind_gust_speed"},m="string"==typeof o.weather_entity?o.weather_entity:"",f=m?this.hass?.states?.[m]:void 0,g=f?.attributes??{},v=this._pastDataAvailable(),y={t:t,cfg:o,fcfg:a,sensorsConfig:l,unitsConfig:c,mode:d,showsStation:_,showsForecast:u,hasSensor:e=>!!l[e],hasLiveValue:e=>{if(l[e])return!0;const t=p[e];if(!t)return!1;return null!=g[t]},pastDataAvailable:v};return e`
      <style>
        h4.subsection {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--secondary-text-color, #727272);
          margin: 18px 0 8px;
        }
        h4.subsection:first-child { margin-top: 4px; }
        .textfield-container {
          display: flex; flex-direction: column; margin-bottom: 10px; gap: 16px;
        }
        .grid2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .gated { margin-left: 12px; display: flex; flex-direction: column; gap: 16px; }
        /* Toggle pills (src/editor/toggle-pills.ts) — every option is
           always visible, filled = on. The label mirrors ha-form's own
           field labels so a pill row reads as one more form field. */
        .pill-field { display: flex; flex-direction: column; gap: 8px; }
        .pill-label {
          font-size: 0.9rem;
          color: var(--secondary-text-color, #727272);
        }
        .pills { display: flex; flex-wrap: wrap; gap: 8px; }
        .pill {
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          border-radius: 16px;
          padding: 7px 14px;
          font-size: 13px;
          font-family: inherit;
          line-height: 1;
          color: var(--primary-text-color, #212121);
          background: transparent;
          cursor: pointer;
          user-select: none;
        }
        .pill:hover { border-color: var(--primary-color, #03a9f4); }
        .pill:focus-visible {
          outline: 2px solid var(--primary-color, #03a9f4);
          outline-offset: 2px;
        }
        .pill.on {
          background: var(--primary-color, #03a9f4);
          border-color: var(--primary-color, #03a9f4);
          /* HA's "text on an accent fill" token — not a hardcoded white,
             which some themes make unreadable on a light accent. */
          color: var(--text-primary-color, #fff);
        }
        /* Layout board (src/editor/layout-board.ts): one dashed drop
           zone per attribute column plus a "new column" zone; pills are
           the rows, dragged with pointer events. touch-action: none on
           the pills keeps a touch drag from scrolling the dialog. */
        .layout-board {
          display: flex;
          align-items: stretch;
          gap: 8px;
        }
        .layout-col {
          flex: 1 1 0;
          min-width: 0;
          min-height: 44px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 6px;
          border: 1px dashed var(--divider-color, rgba(0, 0, 0, 0.2));
          border-radius: 8px;
        }
        .layout-col.new {
          flex: 0 0 auto;
          justify-content: center;
          align-items: center;
          padding: 6px 10px;
          font-size: 12px;
          color: var(--secondary-text-color, #727272);
          writing-mode: vertical-rl;
        }
        .layout-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          text-align: left;
          white-space: normal;
          line-height: 1.2;
          cursor: grab;
          touch-action: none;
        }
        .layout-pill ha-icon {
          --mdc-icon-size: 16px;
          flex: none;
          opacity: 0.7;
        }
        .layout-pill.dragging {
          opacity: 0.35;
          border-style: dashed;
        }
        .link-button {
          align-self: flex-start;
          background: none;
          border: none;
          padding: 0;
          font: inherit;
          font-size: 0.85rem;
          color: var(--primary-color, #03a9f4);
          cursor: pointer;
        }
        .divider {
          border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          margin: 4px 0;
        }
        .loc-search { display: flex; align-items: center; gap: 8px; }
        .loc-search ha-form { flex: 1; }
        .loc-results { display: flex; flex-direction: column; margin: 0 0 12px; }
        .loc-hit {
          text-align: left;
          padding: 8px 12px;
          background: none;
          border: 0;
          border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          color: var(--primary-text-color, #212121);
          font: inherit;
          cursor: pointer;
        }
        .loc-hit:hover { background: var(--secondary-background-color, rgba(0, 0, 0, 0.05)); }
        .loc-determine { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .loc-status { font-size: 0.85rem; color: var(--secondary-text-color, #727272); }
        .loc-status.error { color: var(--error-color, #db4437); }
        .hint {
          font-size: 0.85rem;
          color: var(--secondary-text-color, #727272);
          margin: 4px 0 12px;
        }
        /* Collapsible section panels (ADR-0023). The header slot holds
           icon + title + state summary + reset; ha-expansion-panel
           draws its own chevron and manages expand/collapse. */
        ha-expansion-panel.editor-panel {
          display: block;
          margin-bottom: 12px;
        }
        .panel-header {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          min-width: 0;
          padding: 2px 0;
        }
        .panel-icon {
          color: var(--secondary-text-color, #727272);
          flex: none;
        }
        .panel-titles { flex: 1; min-width: 0; }
        .panel-title {
          font-size: 0.95rem;
          font-weight: 500;
          color: var(--primary-text-color, #212121);
        }
        .panel-summary {
          font-size: 0.8rem;
          color: var(--secondary-text-color, #727272);
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .panel-reset {
          --mdc-icon-button-size: 32px;
          --mdc-icon-size: 18px;
          color: var(--secondary-text-color, #727272);
          opacity: 0.7;
          flex: none;
        }
        .panel-reset:hover {
          opacity: 1;
          color: var(--primary-text-color, #212121);
        }
        .panel-body { padding: 12px 4px 4px; }
        .editor-footer {
          margin-top: 24px;
          padding-top: 12px;
          border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          text-align: right;
        }
        .editor-footer a {
          color: var(--primary-color, #03a9f4);
          text-decoration: none;
          font-size: 0.9rem;
        }
        .editor-footer a:hover { text-decoration: underline; }
      </style>

      <div>
        ${function(t,o){const{t:a,cfg:i}=o,n="object"==typeof i.location&&null!==i.location?i.location:{},s="string"==typeof n.time_zone?n.time_zone:"",r="number"==typeof n.latitude&&"number"==typeof n.longitude,l="number"==typeof n.elevation?n.elevation:void 0,c=t.hass?.config,d=t._locUi,h=function(){const e=Intl.supportedValuesOf;if("function"!=typeof e)return null;try{return e.call(Intl,"timeZone")}catch{return null}}(),u=[{name:"elevation",selector:{number:{min:-500,max:9e3,step:1,mode:"box"}}},{name:"time_zone",selector:h?{select:{mode:"dropdown",custom_value:!1,options:(s&&!h.includes(s)?[s,...h]:h).map(e=>({value:e,label:e}))}}:{text:{}}}],_="string"==typeof i.time_zone&&""!==i.time_zone?i.time_zone:"server",p=[{value:"location",label:a("time_zone_location")},{value:"server",label:a("time_zone_server")}];p.some(e=>e.value===_)||p.push({value:_,label:_});const m=[{name:"time_zone",selector:{select:{mode:"dropdown",options:p}}}],f=p.find(e=>e.value===_)?.label??_,g=e=>"number"==typeof e?e.toFixed(2):"",v=[c?.location_name,null!=c?.latitude&&null!=c?.longitude?`${g(c.latitude)}, ${g(c.longitude)}`:"","number"==typeof c?.elevation?`${c.elevation} m`:"",c?.time_zone].filter(Boolean),y=r?[`${g(n.latitude)}, ${g(n.longitude)}`,void 0!==l?`${l} m`:"",f].filter(Boolean).join(" · "):[a("location_summary_home"),c?.location_name].filter(Boolean).join(" · "),b=r?e`
    <div class="loc-search">
      <ha-form
        .data=${{query:d.query}}
        .schema=${[{name:"query",selector:{text:{}}}]}
        .hass=${t.hass}
        .computeLabel=${()=>a("location_search_label")}
        @value-changed=${t._locationQueryChanged}
      ></ha-form>
      <ha-button class="loc-search-button" @click=${()=>{t._locationSearch()}}>
        ${a("location_search_button")}
      </ha-button>
    </div>
    ${d.results.length?e`
      <div class="loc-results">
        ${d.results.map(o=>e`
          <button type="button" class="loc-hit" @click=${()=>t._locationPick(o)}>
            ${function(e){return[e.name,e.admin1,e.country].filter(Boolean).join(", ")}(o)}
          </button>
        `)}
      </div>
    `:""}
    <ha-form
      .data=${{location:{latitude:n.latitude,longitude:n.longitude}}}
      .schema=${[{name:"location",selector:{location:{}}}]}
      .hass=${t.hass}
      .computeLabel=${()=>a("location_map_label")}
      @value-changed=${t._locationMapChanged}
    ></ha-form>
    <div class="loc-determine">
      <ha-button @click=${()=>{t._locationDetermine()}}>
        ${a("location_determine_button")}
      </ha-button>
      ${d.status?e`<span class="loc-status ${d.status.kind}">${d.status.text}</span>`:""}
    </div>
    <ha-form
      .data=${{elevation:l,time_zone:s||void 0}}
      .schema=${u}
      .hass=${t.hass}
      .computeLabel=${e=>"elevation"===e.name?a("elevation"):a("location_time_zone")}
      @value-changed=${t._locationChanged}
    ></ha-form>
    <ha-form
      .data=${{time_zone:_}}
      .schema=${m}
      .hass=${t.hass}
      .computeLabel=${()=>a("time_zone_label")}
      @value-changed=${t._timeZoneModeChanged}
    ></ha-form>
    <div class="hint">${a("location_attribution")}</div>
  `:"",w=e`
    <div class="textfield-container">
      <div class="hint loc-home">
        ${a("location_home_label")}: ${v.join(" · ")}
      </div>
      <ha-form
        .data=${{use_location:r}}
        .schema=${[{name:"use_location",selector:{boolean:{}}}]}
        .hass=${t.hass}
        .computeLabel=${()=>a("location_use_other")}
        @value-changed=${t._locationSwitchChanged}
      ></ha-form>
      ${b}
    </div>
  `;return L({editor:t,sectionKey:"location",icon:"mdi:map-marker",title:a("location_heading"),summary:y,resetLabel:a("reset_section"),body:w})}(this,y)}
        ${function(t,o){const{t:a,cfg:i,fcfg:n,mode:s,showsForecast:r,pastDataAvailable:l}=o,c=[{name:"mode",selector:{select:{mode:"dropdown",options:[{value:"combination",label:a("mode_combination")},{value:"station",label:a("mode_station")},{value:"forecast",label:a("mode_forecast")}]}}}],d=[{name:"type",selector:{select:{mode:"dropdown",options:[{value:"daily",label:a("forecast_type_daily")},{value:"today",label:a("forecast_type_today")},{value:"hourly",label:a("forecast_type_hourly")}]}}}];return e`
    <div class="textfield-container">
      <ha-form
        .data=${{mode:s}}
        .schema=${c}
        .hass=${t.hass}
        .disabled=${!l}
        .computeLabel=${()=>a("mode_label")}
        @value-changed=${e=>{const o=e.detail.value?.mode;o&&o!==s&&t._setMode(o)}}
      ></ha-form>

      <div class="grid2">
        <ha-form
          .data=${{type:n.type||"daily"}}
          .schema=${d}
          .hass=${t.hass}
          .computeLabel=${()=>a("chart_type_label")}
          @value-changed=${e=>{const o=e.detail.value?.type;o&&o!==n.type&&t._valueChanged({target:{value:o}},"forecast.type")}}
        ></ha-form>
        <ha-form
          .data=${{title:i.title||""}}
          .schema=${[{name:"title",selector:{text:{}}}]}
          .hass=${t.hass}
          .computeLabel=${()=>a("title")}
          @value-changed=${t._chartTopChanged}
        ></ha-form>
      </div>

      ${r?e`
        <ha-form
          .data=${{weather_entity:i.weather_entity||""}}
          .schema=${z}
          .hass=${t.hass}
          .computeLabel=${()=>a("weather_entity")}
          @value-changed=${e=>{const o=e.detail.value?.weather_entity??"";t._valueChanged({target:{value:o}},"weather_entity")}}
        ></ha-form>
      `:""}
    </div>
  `}(this,y)}
        ${function(t,o){const{t:a,sensorsConfig:i,pastDataAvailable:n,showsStation:s}=o;if(!s&&n)return e``;const r=t._pastSource,l=[{name:"past_source",selector:{select:{mode:"dropdown",options:[{value:"station",label:a("past_source_station")},{value:"openmeteo",label:a("past_source_openmeteo")}]}}}],c=Object.values(i).filter(e=>"string"==typeof e&&""!==e.trim()).length,d="openmeteo"===r?a("summary_openmeteo"):c>0?a("summary_connected").replace("{n}",String(c)):a("summary_no_sensors"),h=e`
    ${n?"":e`
      <div class="hint">${a("openmeteo_history_unavailable")}</div>
    `}

    <div class="textfield-container">
      <ha-form
        .data=${{past_source:r}}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${()=>a("past_source_label")}
        @value-changed=${e=>{const o=e.detail.value?.past_source;o&&o!==r&&t._setPastSource(o)}}
      ></ha-form>

      ${"openmeteo"===r?e`
        <div class="hint">${a("openmeteo_history_hint")}</div>
      `:e`
        <ha-form
          .data=${i}
          .schema=${u=t.hass,[{name:"",type:"grid",schema:U(u).map(e=>({name:e.key,required:S.has(e.key),selector:{entity:e.candidates.length>0?{include_entities:e.candidates}:{domain:"sensor"}}}))}]}
          .hass=${t.hass}
          .computeLabel=${e=>{const t=a(e.name);return e.required?`${t} (${a("required_marker")})`:t}}
          @value-changed=${t._sensorsChanged}
        ></ha-form>
      `}
    </div>
  `;var u;return L({editor:t,sectionKey:"sensors",icon:"mdi:thermometer",title:a("station_sensors_heading"),summary:d,resetLabel:a("reset_section"),body:h})}(this,y)}
        ${function(t,o){const{t:a,cfg:i,fcfg:n,showsStation:s,showsForecast:r}=o,l=[{name:"",type:"grid",schema:[...s?[{name:"days",selector:{number:{min:1,max:14,mode:"box"}}}]:[],...r?[{name:"forecast_days",selector:{number:{min:1,max:14,mode:"box"}}}]:[]]}],c=[{name:"style",selector:{select:{mode:"dropdown",options:[{value:"style2",label:a("chart_style_without_boxes")},{value:"style1",label:a("chart_style_with_boxes")}]}}},{name:"round_temp",selector:{boolean:{}}},{name:"disable_animation",selector:{boolean:{}}}],d={days:a("days"),forecast_days:a("forecast_days"),number_of_forecasts:a("number_of_forecasts"),chart_height:a("chart_height"),style:a("chart_style"),round_temp:a("round_temp"),disable_animation:a("disable_animation")},h=e=>d[e.name]||a(e.name),u=function(e){return A.filter(({path:t,def:o})=>{const a=e[O(t)];return o?!1!==a:!0===a}).map(({path:e})=>O(e))}(n),_=[...s?[String(i.days??7)]:[],...r?[String(i.forecast_days??7)]:[]].join("+"),p=n.number_of_forecasts??8,m=`${_} ${a("summary_days")} · ${p} ${a("summary_columns")} · ${u.length} ${a("summary_rows")}`,f=e`
    <h4 class="subsection">${a("chart_time_range_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{days:i.days,forecast_days:i.forecast_days}}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${h}
        @value-changed=${t._chartTopChanged}
      ></ha-form>
      <ha-form
        .data=${{number_of_forecasts:n.number_of_forecasts,chart_height:n.chart_height}}
        .schema=${[{name:"",type:"grid",schema:[{name:"number_of_forecasts",selector:{number:{min:0,mode:"box"}}},{name:"chart_height",selector:{number:{min:80,max:600,mode:"box"}}}]}]}
        .hass=${t.hass}
        .computeLabel=${h}
        @value-changed=${t._chartForecastChanged}
      ></ha-form>
      <p class="hint">${a("number_of_forecasts_helper")}</p>
    </div>

    <h4 class="subsection">${a("chart_rows_heading")}</h4>
    <div class="textfield-container">
      ${q({group:"chart_rows",options:A.map(({path:e,labelKey:t})=>({value:O(e),label:a(t)})),selected:u,onChange:e=>{t._applyTogglePaths(A,e)}})}
      ${!0===n.show_sunshine?e`
        <div class="hint">${a("show_chart_sunshine_hint")}</div>
        <div>${t._renderSunshineAvailabilityHint(i,a)}</div>
      `:""}
      ${!0===n.show_precip_probability?e`
        <div class="hint">${a("show_chart_precip_probability_hint")}</div>
      `:""}
    </div>

    <h4 class="subsection">${a("chart_appearance_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{style:n.style||"style2",round_temp:!0===n.round_temp,disable_animation:!0===n.disable_animation}}
        .schema=${c}
        .hass=${t.hass}
        .computeLabel=${h}
        @value-changed=${t._chartForecastChanged}
      ></ha-form>
    </div>

    <!-- Remaining chart sizes (labels_font_size, precip_bar_size) and
         colour overrides (temperature1/2_color, precipitation_color,
         sunshine_color, chart_text_color, chart_datetime_color) live
         in DEFAULTS + YAML only — colours are theme-aware out of the
         box and the editor surface stays cleaner without them. -->
  `;return L({editor:t,sectionKey:"chart",icon:"mdi:chart-line",title:a("chart_section_heading"),summary:m,resetLabel:a("reset_section"),body:f})}(this,y)}
        ${function(t,o){const{t:a,cfg:l,hasSensor:c,hasLiveValue:d}=o,h=!0===l.show_main,u=!0===l.show_attributes,_=e=>[{name:e,selector:{boolean:{}}}],p=[{name:"clock_mode",selector:{select:{mode:"dropdown",options:R.map(e=>({value:e,label:a(`clock_${e}`)}))}}}],m=[{name:"time_format",selector:{select:{mode:"dropdown",options:I.map(e=>({value:e,label:a(`clock_${e}`)}))}}}],f=function(e,t){return B.filter(({gate:o,gateKey:a,requireAll:i})=>{if(!o||!a)return!0;const n="string"==typeof a?[a]:a,s="live"===o?e:t;return i?n.every(s):n.some(s)})}(d,c),g=e=>({show_main:a("show_main"),show_attributes:a("show_attributes"),clock_mode:a("clock_label"),time_format:a("time_format_label")}[e.name]||a(e.name)),v=i(t.hass)?e`<div class="hint">${a("next_rain_enable_hint")}</div>`:"",y=function(e,t){const o=new Set(n(e).flat());return t.filter(({path:e})=>{const t=s(e);return void 0!==t&&o.has(t)}).map(({path:e})=>e)}(l,f),b=function(t,o,a){const{t:i,cfg:l}=o,c=new Set(a.map(s).filter(e=>void 0!==e)),d=n(l).map(e=>e.filter(e=>c.has(e))).filter(e=>e.length>0);return 0===d.length?e``:M({layout:d,explicit:r(l),labelFor:e=>Y(i,`show_${e}`),t:i,onChange:e=>t._setAttributesLayout(e),onReset:()=>t._setAttributesLayout(null),rerender:()=>t.requestUpdate()})}(t,o,y),w=`${a("main_panel_heading")} ${a(h?"summary_on":"summary_off")} · `+(u?`${y.length} ${a("summary_attributes")}`:`${a("attributes_heading")} ${a("summary_off")}`),$=e`
    <div class="textfield-container">
      <ha-form
        .data=${{show_main:h}}
        .schema=${_("show_main")}
        .hass=${t.hass}
        .computeLabel=${g}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
      ${h?e`
        <div class="gated">
          ${q({label:a("main_elements_label"),group:"main_elements",options:D.map(({path:e})=>({value:e,label:a(e)})),selected:J(l,D),onChange:e=>t._applyTogglePaths(D,e)})}
          <ha-form
            .data=${{clock_mode:t._clockMode}}
            .schema=${p}
            .hass=${t.hass}
            .computeLabel=${g}
            @value-changed=${e=>{const o=e.detail.value?.clock_mode;o&&o!==t._clockMode&&t._setClockMode(o)}}
          ></ha-form>
        </div>
      `:""}

      <div class="divider"></div>

      <ha-form
        .data=${{show_attributes:u}}
        .schema=${_("show_attributes")}
        .hass=${t.hass}
        .computeLabel=${g}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
      ${u?e`
        <div class="gated">
          ${q({label:a("attributes_heading"),group:"attributes",options:f.map(({path:e})=>({value:e,label:Y(a,e)})),selected:y,onChange:e=>t._applyAttributeToggles(f,e)})}
          ${b}
          <h4 class="subsection">${a("time_format_scope")}</h4>
          <ha-form
            .data=${{time_format:t._timeFormat}}
            .schema=${m}
            .hass=${t.hass}
            .computeLabel=${g}
            @value-changed=${e=>{const o=e.detail.value?.time_format;o&&o!==t._timeFormat&&t._setTimeFormat(o)}}
          ></ha-form>
          <div class="hint">${a("time_format_hint")}</div>
          ${v}
        </div>
      `:""}
    </div>
  `;return L({editor:t,sectionKey:"live_panel",icon:"mdi:clock-outline",title:a("live_panel_heading"),summary:w,resetLabel:a("reset_section"),body:$})}(this,y)}
        ${function(t,o){const{t:a,unitsConfig:i}=o,n=[i.pressure||"hPa",i.speed||"km/h",i.precipitation||"mm"].join(" · "),s=e`
    <div class="textfield-container">
      <ha-form
        .data=${i}
        .schema=${X}
        .hass=${t.hass}
        .computeLabel=${e=>({pressure:a("unit_pressure_label"),speed:a("unit_speed_label"),precipitation:a("unit_precipitation_label")}[e.name]||e.name)}
        @value-changed=${t._unitsChanged}
      ></ha-form>
    </div>
  `;return L({editor:t,sectionKey:"units",icon:"mdi:ruler",title:a("units_heading"),summary:n,resetLabel:a("reset_section"),body:s})}(this,y)}
        ${function(t,o){const{t:a,cfg:i}=o,n=i.tap_action?.action||"none",s=`${a("tap_action_label")}: ${n}`,r=e`
    <div class="textfield-container">
      ${[["tap_action","tap_action_label"],["hold_action","hold_action_label"],["double_tap_action","double_tap_action_label"]].map(([o,n])=>e`
        <ha-selector
          .hass=${t.hass}
          .selector=${{ui_action:{}}}
          .value=${i[o]}
          .label=${a(n)}
          @value-changed=${e=>t._actionChanged(o,e.detail.value)}
        ></ha-selector>
      `)}
    </div>
  `;return L({editor:t,sectionKey:"actions",icon:"mdi:gesture-tap",title:a("actions_section_heading"),summary:s,resetLabel:a("reset_section"),body:r})}(this,y)}
        <div class="editor-footer">
          <a href="https://github.com/chriguschneider/weather-station-card/blob/master/docs/CONFIGURATION.md"
             target="_blank" rel="noopener noreferrer">
            📖 ${t("open_documentation")}
          </a>
        </div>
      </div>
    `}});
