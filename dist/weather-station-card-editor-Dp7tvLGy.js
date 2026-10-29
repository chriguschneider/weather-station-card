import{b as e,f as t,A as a,n as o,r as n,a as i,t as s,h as r,i as l,c,d,e as h,s as u,v as p,g as _,j as f,k as m,C as g,l as y,D as b,m as v,o as w}from"./main-jqWEklPv.js";const $=[{name:"weather_entity",required:!0,selector:{entity:{domain:"weather"}}}];function x(t){const{editor:a,sectionKey:o,icon:n,title:i,summary:s,resetLabel:r,body:l}=t;return e`
    <ha-expansion-panel
      outlined
      class="editor-panel"
      .expanded=${a._isPanelExpanded(o)}
      @expanded-changed=${e=>a._setPanelExpanded(o,!0===e.detail?.expanded)}
    >
      <div slot="header" class="panel-header">
        <ha-icon class="panel-icon" .icon=${n}></ha-icon>
        <div class="panel-titles">
          <div class="panel-title">${i}</div>
          <div class="panel-summary">${s}</div>
        </div>
        <ha-icon-button
          class="panel-reset"
          title=${r}
          aria-label=${r}
          @click=${e=>{e.stopPropagation(),a._resetSection(o)}}
        ><ha-icon icon="mdi:restore"></ha-icon></ha-icon-button>
      </div>
      <div class="panel-body">${l}</div>
    </ha-expansion-panel>
  `}const C=new Set(["temperature"]);function k(e){const a=e?.states?Object.entries(e.states).filter(([,e])=>!!e):[],o=e=>a.filter(([t,a])=>t.startsWith("sensor.")&&e.includes(a.attributes?.device_class||"")).map(([e])=>e),n=a.filter(([e,t])=>e.startsWith("sensor.")&&("°"===t.attributes?.unit_of_measurement||"deg"===t.attributes?.unit_of_measurement)).map(([e])=>e),i=/^(mm|in|inch|inches|")\/(h|hr|hour)$/i,s=a.filter(([e,t])=>e.startsWith("sensor.")&&("precipitation_intensity"===t.attributes?.device_class||i.test(t.attributes?.unit_of_measurement||""))).map(([e])=>e),r=/zero[._ -]?degree|freezing[._ -]?level|nullgrad|snow[._ -]?line/i,l=a.filter(([e,t])=>e.startsWith("sensor.")&&(r.test(e)||r.test(t.attributes?.friendly_name||""))).map(([e])=>e),c=/next[._ -]?rain|n[aä]chster[._ -]?regen/i,d=t(e),h=a.filter(([e,t])=>e.startsWith("sensor.")&&(e===d||c.test(e)||c.test(t.attributes?.friendly_name||""))).map(([e])=>e),u=/(?:^|[._-])uv(?:[._-]|index|$)/i,p=/\buv[\s_-]?index\b|\buv\b/i,_=a.filter(([e,t])=>{if(!e.startsWith("sensor."))return!1;const a=t.attributes?.friendly_name||"";return u.test(e)||p.test(a)}).map(([e])=>e);return[{key:"temperature",candidates:o(["temperature"])},{key:"pressure",candidates:o(["atmospheric_pressure","pressure"])},{key:"humidity",candidates:o(["humidity"])},{key:"dew_point",candidates:o(["temperature"])},{key:"precipitation",candidates:o(["precipitation"])},{key:"precipitation_rate",candidates:s},{key:"wind_speed",candidates:o(["wind_speed","speed"])},{key:"gust_speed",candidates:o(["wind_speed","speed"])},{key:"wind_direction",candidates:n},{key:"illuminance",candidates:o(["illuminance","irradiance"])},{key:"uv_index",candidates:_},{key:"sunshine_duration",candidates:[]},{key:"zero_degree_level",candidates:l},{key:"zero_degree_level_48h",candidates:l},{key:"next_rain",candidates:h}]}const z=[{name:"elevation",selector:{number:{min:-500,max:9e3,step:1,mode:"box"}}}];function L(t){const{label:a,options:o,selected:n,onChange:i,group:s}=t,r=new Set(n);return e`
    <div class="pill-field">
      ${a?e`<div class="pill-label">${a}</div>`:""}
      <div class="pills" data-group=${s}>
        ${o.map(t=>{const a=r.has(t.value);return e`
            <button
              type="button"
              class="pill ${a?"on":""}"
              role="switch"
              aria-checked=${a?"true":"false"}
              data-value=${t.value}
              @click=${()=>(e=>{const t=new Set(r);t.has(e)?t.delete(e):t.add(e),i(o.map(e=>e.value).filter(e=>t.has(e)))})(t.value)}
            >${t.label}</button>
          `})}
      </div>
    </div>
  `}const S=[{path:"forecast.condition_icons",def:!0,labelKey:"show_chart_icons"},{path:"forecast.show_wind_arrow",def:!0,labelKey:"show_chart_wind_direction"},{path:"forecast.show_wind_speed",def:!0,labelKey:"show_chart_wind_speed"},{path:"forecast.show_date",def:!0,labelKey:"show_chart_date"},{path:"forecast.show_sunshine",def:!1,labelKey:"show_chart_sunshine"},{path:"forecast.show_precip_probability",def:!1,labelKey:"show_chart_precip_probability"},{path:"forecast.show_mode_toggle",def:!0,labelKey:"show_chart_mode_toggle"}],A=e=>e.split(".").pop();function O(e,t,a){const o=e.map(e=>e.filter(e=>e!==t));for(;o.length<=a.column;)o.push([]);const n=o[a.column];return n.splice(Math.max(0,Math.min(a.index,n.length)),0,t),o}function q(e,t,a){return e<t?t-e:e>a?e-a:0}const K={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right"};let P=null;function U(e,t){return JSON.stringify(e)===JSON.stringify(t)}function j(e){const t=P;if(!t)return;window.removeEventListener("pointermove",t.onMove),window.removeEventListener("pointerup",t.onUp),window.removeEventListener("pointercancel",t.onCancel),t.ghost?.remove(),P=null;const a=t.active&&!U(o(t.preview),o(t.base));e&&a?t.onChange(o(t.preview)):t.rerender()}function N(e,t){if(0!==e.button)return;P&&j(!1);const a=e.currentTarget,o=a.closest(".layout-board");if(!o)return;const n=a.getBoundingClientRect(),i={token:t.token,board:o,startX:e.clientX,startY:e.clientY,grabOffsetX:e.clientX-n.left,grabOffsetY:e.clientY-n.top,pillWidth:n.width,pillHeight:n.height,label:t.label,active:!1,base:t.layout,preview:t.layout,ghost:null,onChange:t.onChange,rerender:t.rerender,onMove:e=>{const t=P;if(!t)return;if(!t.active){const a=e.clientX-t.startX,o=e.clientY-t.startY;if(a*a+o*o<36)return;t.active=!0,t.ghost=function(e){const t=document.createElement("div");return t.textContent=e.label,t.setAttribute("aria-hidden","true"),Object.assign(t.style,{position:"fixed",left:"0",top:"0",width:`${e.pillWidth}px`,boxSizing:"border-box",padding:"7px 14px",borderRadius:"16px",fontSize:"13px",lineHeight:"1.2",fontFamily:"inherit",background:"var(--primary-color, #03a9f4)",color:"var(--text-primary-color, #fff)",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.3)",pointerEvents:"none",zIndex:"10000",opacity:"0.9"}),document.body.appendChild(t),t}(t),t.rerender()}e.preventDefault(),function(e,t,a){e.ghost&&(e.ghost.style.transform=`translate(${t-e.grabOffsetX}px, ${a-e.grabOffsetY}px)`)}(t,e.clientX,e.clientY);const a=function(e,t,a){if(0===t.length)return null;let o=0,n=1/0;t.forEach((t,a)=>{const i=function(e,t,a){const o=q(e,a.left,a.right),n=q(t,a.top,a.bottom);return o*o+n*n}(e.x,e.y,t.rect);i<n&&(n=i,o=a)});const i=t[o].pills.filter(e=>e.token!==a).filter(t=>(t.rect.top+t.rect.bottom)/2<e.y).length;return{column:o,index:i}}({x:e.clientX,y:e.clientY},function(e){return Array.from(e.querySelectorAll("[data-col]")).map(e=>({rect:e.getBoundingClientRect(),pills:Array.from(e.querySelectorAll("[data-token]")).map(e=>({token:e.dataset.token,rect:e.getBoundingClientRect()}))}))}(t.board),t.token);if(!a)return;const o=O(t.base,t.token,a);U(o,t.preview)||(t.preview=o,t.rerender())},onUp:()=>j(!0),onCancel:()=>j(!1)};P=i,window.addEventListener("pointermove",i.onMove),window.addEventListener("pointerup",i.onUp),window.addEventListener("pointercancel",i.onCancel)}function T(t){const{layout:n,explicit:i,labelFor:s,t:r,onChange:l,onReset:c,rerender:d}=t,h=P?.active?P.preview:n,u=P?.active?P.token:null,p=t=>e`
    <div
      class="pill on layout-pill ${t===u?"dragging":""}"
      data-token=${t}
      tabindex="0"
      role="option"
      aria-label=${s(t)}
      @pointerdown=${e=>N(e,{token:t,label:s(t),layout:n,onChange:l,rerender:d})}
      @keydown=${e=>((e,t)=>{const a=K[e.key];if(!a)return;e.preventDefault();const i=function(e,t,a){const n=e.findIndex(e=>e.includes(t));if(n<0)return e;const i=e[n].indexOf(t);let s;switch(a){case"up":if(0===i)return e;s={column:n,index:i-1};break;case"down":if(i>=e[n].length-1)return e;s={column:n,index:i+1};break;case"left":if(0===n)return e;s={column:n-1,index:Math.min(i,e[n-1].length)};break;case"right":if(n===e.length-1&&1===e[n].length)return e;s={column:n+1,index:Math.min(i,e[n+1]?.length??0)}}return o(O(e,t,s))}(n,t,a);if(i===n)return;l(i);const s=e.currentTarget.closest(".layout-board");requestAnimationFrame(()=>{s?.querySelector(`[data-token="${t}"]`)?.focus()})})(e,t)}
    ><ha-icon icon="mdi:drag-vertical"></ha-icon><span>${s(t)}</span></div>
  `;return e`
    <div class="pill-field">
      <div class="pill-label">${r("layout_board_label")}</div>
      <div class="layout-board" role="listbox" aria-label=${r("layout_board_label")}>
        ${h.map((t,a)=>e`
          <div class="layout-col ${0===t.length?"empty":""}" data-col=${a}>
            ${t.map(p)}
          </div>
        `)}
        <div class="layout-col new" data-col=${h.length}>
          <span>${r("layout_board_new_column")}</span>
        </div>
      </div>
      <div class="hint">${r("layout_board_hint")}</div>
      ${i?e`
        <button type="button" class="link-button" @click=${c}>${r("layout_board_reset")}</button>
      `:a}
    </div>
  `}const E=[{path:"show_temperature",def:!0},{path:"show_current_condition",def:!1},{path:"show_day",def:!1},{path:"show_date",def:!1}],F=[{path:"show_pressure",def:!0,gate:"live",gateKey:"pressure"},{path:"show_dew_point_humidity",def:!1,gate:"live",gateKey:["dew_point","humidity"],requireAll:!0},{path:"show_dew_point",def:!1,gate:"live",gateKey:"dew_point"},{path:"show_humidity",def:!1,gate:"live",gateKey:"humidity"},{path:"show_precipitation",def:!0,gate:"sensor",gateKey:["precipitation","precipitation_rate"]},{path:"show_next_rain",def:!1,gate:"sensor",gateKey:"next_rain"},{path:"show_zero_degree_level",def:!1,gate:"sensor",gateKey:"zero_degree_level"},{path:"show_zero_degree_level_48h",def:!1,gate:"sensor",gateKey:"zero_degree_level_48h"},{path:"show_uv_illuminance",def:!1,gate:"live",gateKey:["uv_index","illuminance"],requireAll:!0},{path:"show_uv_index",def:!0,gate:"live",gateKey:"uv_index"},{path:"show_illuminance",def:!1,gate:"sensor",gateKey:"illuminance"},{path:"show_wind_direction",def:!0,gate:"live",gateKey:"wind_direction"},{path:"show_wind_speed",def:!0,gate:"live",gateKey:"wind_speed"},{path:"show_wind_gust_speed",def:!1,gate:"live",gateKey:"gust_speed"},{path:"show_sun",def:!1},{path:"show_moon",def:!0}],M=["off","on","on_seconds"],D=["24h","12h"];function B(e,t){return t.filter(({path:t,def:a})=>a?!1!==e[t]:!0===e[t]).map(({path:e})=>e)}function J(e,t){const a=t.split(".").pop()??t;return"show_dew_point_humidity"===a?`${e("show_dew_point")} + ${e("show_humidity")}`:"show_uv_illuminance"===a?`${e("show_uv_index")} + ${e("show_illuminance")}`:e(a)}const R=[{name:"",type:"grid",schema:[{name:"pressure",selector:{select:{mode:"dropdown",options:["hPa","mmHg","inHg"]}}},{name:"speed",selector:{select:{mode:"dropdown",options:["km/h","m/s","mph","Bft"]}}},{name:"precipitation",selector:{select:{mode:"dropdown",options:["mm","in"]}}}]}],Y={basics:["show_station","show_forecast","forecast.type","title","weather_entity"],sensors:["sensors","forecast.openmeteo_history","elevation"],chart:["days","forecast_days","forecast.number_of_forecasts","forecast.chart_height","forecast.condition_icons","forecast.show_wind_arrow","forecast.show_wind_speed","forecast.show_date","forecast.show_sunshine","forecast.show_precip_probability","forecast.show_mode_toggle","forecast.style","forecast.round_temp","forecast.disable_animation"],live_panel:["show_main","show_temperature","show_current_condition","show_time","show_time_seconds","use_12hour_format","show_day","show_date","show_attributes","show_humidity","show_pressure","show_dew_point","show_precipitation","show_uv_index","show_illuminance","show_wind_direction","show_wind_speed","show_wind_gust_speed","show_sun","show_moon","show_zero_degree_level","show_zero_degree_level_48h","show_next_rain","show_dew_point_humidity","show_uv_illuminance","attributes_layout"],location:["location","time_zone"],units:["units"],actions:["tap_action","hold_action","double_tap_action"]};customElements.define("weather-station-card-editor",class extends l{constructor(){super(...arguments),this.hass=null,this._config=null,this._setPastSource=e=>{if(!this._config)return;const t={...this._config},a={...t.forecast??{}};"openmeteo"===e?(a.openmeteo_history=!0,t.forecast=a,delete t.sensors):(delete a.openmeteo_history,0===Object.keys(a).length?delete t.forecast:t.forecast=a),this.configChanged(t),this.requestUpdate()},this._setClockMode=e=>{const t=[];"off"!==e&&t.push("show_time"),"on_seconds"===e&&t.push("show_time_seconds"),this._applyTogglePaths([{path:"show_time",def:!1},{path:"show_time_seconds",def:!1}],t)},this._setTimeFormat=e=>{this._applyTogglePaths([{path:"use_12hour_format",def:!1}],"12h"===e?["use_12hour_format"]:[])},this._applyTogglePaths=(e,t)=>{if(!this._config)return;const a=new Set(t),o=JSON.parse(JSON.stringify(this._config));for(const{path:t,def:n}of e){const e=t.split(".").pop(),i=a.has(e);i===n?this._deleteByPath(o,t):this._setByPath(o,t,i)}this.configChanged(o),this.requestUpdate()},this._applyAttributeToggles=(e,t)=>{if(!this._config)return;const a=new Set(t),o=JSON.parse(JSON.stringify(this._config));let n=i(this._config);for(const{path:t}of e){const e=s(t);if(!e)continue;const o=t.split(".").pop();n=a.has(o)?c(n,e):d(n,e)}this._setAttributesLayout(n,o)},this._setAttributesLayout=(e,t)=>{if(!this._config)return;const a=t??JSON.parse(JSON.stringify(this._config));if(null===e){const e=new Set(i(this._config).flat());delete a.attributes_layout;for(const t of h){const o=u(t),n=!0===b[o],i=e.has(t);i===n?delete a[o]:a[o]=i}}else{a.attributes_layout=o(e);for(const e of h)delete a[u(e)]}this.configChanged(a),this.requestUpdate()},this._expandedPanels={},this._sensorsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail;this.configChanged({...this._config,sensors:a.value}),this.requestUpdate()},this._sensorPickerChanged=(e,t)=>{if(!this._config)return;const a={...this._config.sensors||{}};""===t||null==t?delete a[e]:a[e]=t,this.configChanged({...this._config,sensors:a}),this.requestUpdate()},this._unitsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail;this.configChanged({...this._config,units:a.value}),this.requestUpdate()},this._chartTopChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,o={...this._config};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged(o),this.requestUpdate()},this._chartForecastChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,o={...this._config.forecast||{}};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged({...this._config,forecast:o}),this.requestUpdate()},this._livePanelChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,o={...this._config};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged(o),this.requestUpdate()},this._locationChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,o={...this._config.location||{}};for(const[e,t]of Object.entries(a.value))null==t||""===t||"time_zone"===e&&void 0===p(t)?delete o[e]:o[e]=t;const n={...this._config};Object.keys(o).length?n.location=o:delete n.location,this.configChanged(n),this.requestUpdate()},this._timeZoneModeChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,o=a.value?.time_zone,n={...this._config};o&&"server"!==o?n.time_zone=o:delete n.time_zone,this.configChanged(n),this.requestUpdate()},this._resetSection=e=>{if(!this._config)return;const t=Y[e];if(!t)return;const a=JSON.parse(JSON.stringify(this._config));for(const e of t)this._deleteByPath(a,e);this.configChanged(a),this.requestUpdate()},this._valueChanged=(e,t)=>{if(!this._config)return;const a={...this._config},o=e.target.checked??e.target.value;if(t.includes(".")){const e=t.split(".");let n=a;for(let t=0;t<e.length-1;t++)n[e[t]]={...n[e[t]]},n=n[e[t]];n[e[e.length-1]]=o}else a[t]=o;this.configChanged(a),this.requestUpdate()},this._actionChanged=(e,t)=>{if(!this._config)return;const a={...this._config};null==t?delete a[e]:a[e]=t,this.configChanged(a),this.requestUpdate()}}static get properties(){return{_config:{type:Object},hass:{type:Object}}}setConfig(e){if(!e)throw new Error("Invalid configuration");this._config=e;const t=this.hass?.language||"en";"en"!==t&&"en"!==t.split("-")[0]&&_(t).then(()=>this.requestUpdate()),this.requestUpdate()}get config(){return this._config}get _mode(){if(!this._config)return"station";const e=!1!==this._config.show_station,t=!0===this._config.show_forecast;return e&&t?"combination":t?"forecast":"station"}_setMode(e){if(!this._config)return;const t={...this._config};switch(e){case"station":t.show_station=!0,t.show_forecast=!1;break;case"forecast":t.show_station=!1,t.show_forecast=!0;break;case"combination":t.show_station=!0,t.show_forecast=!0}this.configChanged(t),this.requestUpdate()}get _pastSource(){const e=this._config?.sensors||{};if(Object.values(e).some(e=>"string"==typeof e&&""!==e.trim()))return"station";const t=this._config?.forecast;return!0===t?.openmeteo_history?"openmeteo":"station"}get _clockMode(){const e=this._config??{};return!0!==e.show_time?"off":!0===e.show_time_seconds?"on_seconds":"on"}get _timeFormat(){return!0===this._config?.use_12hour_format?"12h":"24h"}_setByPath(e,t,a){const o=t.split(".");let n=e;for(let e=0;e<o.length-1;e++){const t=n[o[e]];t&&"object"==typeof t||(n[o[e]]={}),n=n[o[e]]}n[o[o.length-1]]=a}_isPanelExpanded(e){return!0===this._expandedPanels[e]}_setPanelExpanded(e,t){this._expandedPanels[e]=t}_pastDataAvailable(){if(!this._config)return!0;const e=this._config.sensors||{},t=Object.values(e).some(e=>"string"==typeof e&&""!==e.trim()),a=this._config.forecast;return t||!0===a?.openmeteo_history}updated(e){e.has("_config")&&this._config&&!this._pastDataAvailable()&&"forecast"!==this._mode&&this._setMode("forecast")}configChanged(e){const t=new Event("config-changed",{bubbles:!0,composed:!0});t.detail={config:e},this.dispatchEvent(t)}_deleteByPath(e,t){const a=t.split("."),o=[e];let n=e;for(let e=0;e<a.length-1;e++){const t=n?.[a[e]];if(!t||"object"!=typeof t)return;n=t,o.push(n)}delete n[a[a.length-1]];for(let e=o.length-1;e>0;e--){const t=o[e];if(!t||0!==Object.keys(t).length)break;delete o[e-1][a[e-1]]}}_renderSunshineAvailabilityHint(t,a){const o=t&&t.forecast;if(!0!==o?.show_sunshine)return"";const n=this.hass,i=f(t,n);if(!i)return"";const s=m(i.latitude,i.longitude,new g(y(t,n?.config?.time_zone).zone));if(!s)return e`<div class="hint" style="margin-top:4px;">
        ${a("sunshine_availability_pending")}
      </div>`;const r=parseInt(String(t.forecast_days??(t.days||7)),10),l=Number.isFinite(r)&&s.forecastDays>0&&r>s.forecastDays,c=(a("sunshine_availability")||"Sunshine: {past} past, {future} forecast days available").replace("{past}",String(s.pastDays)).replace("{future}",String(s.forecastDays));return e`
      <div class="hint" style="margin-top:4px;">
        ${c}
        ${l?e`<br/>${(a("sunshine_availability_warning")||"Configured forecast_days ({req}) exceeds available — last {gap} columns will have empty sunshine bars.").replace("{req}",String(r)).replace("{gap}",String(r-s.forecastDays))}`:""}
      </div>
    `}render(){const t=e=>function(e,t){const a=e?.language||"en",o=a.split("-")[0];for(const e of[a,v(a),o,"en"]){const a=w[e]?.editor;if(a&&"string"==typeof a[t])return a[t]}return t}(this.hass,e),a=this._config??{},o=a.forecast??{},l=a.sensors??{},c=a.units??{},d=this._mode,h="combination"===d,u="forecast"===d||h,p="station"===d||h,_={humidity:"humidity",pressure:"pressure",dew_point:"dew_point",uv_index:"uv_index",wind_direction:"wind_bearing",wind_speed:"wind_speed",gust_speed:"wind_gust_speed"},f="string"==typeof a.weather_entity?a.weather_entity:"",m=f?this.hass?.states?.[f]:void 0,g=m?.attributes??{},y=this._pastDataAvailable(),b={t:t,cfg:a,fcfg:o,sensorsConfig:l,unitsConfig:c,mode:d,showsStation:p,showsForecast:u,hasSensor:e=>!!l[e],hasLiveValue:e=>{if(l[e])return!0;const t=_[e];if(!t)return!1;return null!=g[t]},pastDataAvailable:y};return e`
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
        ${function(t,a){const{t:o,cfg:n,fcfg:i,mode:s,showsForecast:r,pastDataAvailable:l}=a,c=[{name:"mode",selector:{select:{mode:"dropdown",options:[{value:"combination",label:o("mode_combination")},{value:"station",label:o("mode_station")},{value:"forecast",label:o("mode_forecast")}]}}}],d=[{name:"type",selector:{select:{mode:"dropdown",options:[{value:"daily",label:o("forecast_type_daily")},{value:"today",label:o("forecast_type_today")},{value:"hourly",label:o("forecast_type_hourly")}]}}}];return e`
    <div class="textfield-container">
      <ha-form
        .data=${{mode:s}}
        .schema=${c}
        .hass=${t.hass}
        .disabled=${!l}
        .computeLabel=${()=>o("mode_label")}
        @value-changed=${e=>{const a=e.detail.value?.mode;a&&a!==s&&t._setMode(a)}}
      ></ha-form>

      <div class="grid2">
        <ha-form
          .data=${{type:i.type||"daily"}}
          .schema=${d}
          .hass=${t.hass}
          .computeLabel=${()=>o("chart_type_label")}
          @value-changed=${e=>{const a=e.detail.value?.type;a&&a!==i.type&&t._valueChanged({target:{value:a}},"forecast.type")}}
        ></ha-form>
        <ha-form
          .data=${{title:n.title||""}}
          .schema=${[{name:"title",selector:{text:{}}}]}
          .hass=${t.hass}
          .computeLabel=${()=>o("title")}
          @value-changed=${t._chartTopChanged}
        ></ha-form>
      </div>

      ${r?e`
        <ha-form
          .data=${{weather_entity:n.weather_entity||""}}
          .schema=${$}
          .hass=${t.hass}
          .computeLabel=${()=>o("weather_entity")}
          @value-changed=${e=>{const a=e.detail.value?.weather_entity??"";t._valueChanged({target:{value:a}},"weather_entity")}}
        ></ha-form>
      `:""}
    </div>
  `}(this,b)}
        ${function(t,a){const{t:o,sensorsConfig:n,pastDataAvailable:i,showsStation:s}=a;if(!s&&i)return e``;const r=t._pastSource,l=[{name:"past_source",selector:{select:{mode:"dropdown",options:[{value:"station",label:o("past_source_station")},{value:"openmeteo",label:o("past_source_openmeteo")}]}}}],c=Object.values(n).filter(e=>"string"==typeof e&&""!==e.trim()).length,d="openmeteo"===r?o("summary_openmeteo"):c>0?o("summary_connected").replace("{n}",String(c)):o("summary_no_sensors"),h=e`
    ${i?"":e`
      <div class="hint">${o("openmeteo_history_unavailable")}</div>
    `}

    <div class="textfield-container">
      <ha-form
        .data=${{past_source:r}}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${()=>o("past_source_label")}
        @value-changed=${e=>{const a=e.detail.value?.past_source;a&&a!==r&&t._setPastSource(a)}}
      ></ha-form>

      ${"openmeteo"===r?e`
        <div class="hint">${o("openmeteo_history_hint")}</div>
      `:e`
        <ha-form
          .data=${n}
          .schema=${u=t.hass,[{name:"",type:"grid",schema:k(u).map(e=>({name:e.key,required:C.has(e.key),selector:{entity:e.candidates.length>0?{include_entities:e.candidates}:{domain:"sensor"}}}))}]}
          .hass=${t.hass}
          .computeLabel=${e=>{const t=o(e.name);return e.required?`${t} (${o("required_marker")})`:t}}
          @value-changed=${t._sensorsChanged}
        ></ha-form>
        <ha-form
          .data=${{elevation:a.cfg.elevation}}
          .schema=${z}
          .hass=${t.hass}
          .computeLabel=${()=>o("elevation")}
          @value-changed=${t._chartTopChanged}
        ></ha-form>
      `}
    </div>
  `;var u;return x({editor:t,sectionKey:"sensors",icon:"mdi:thermometer",title:o("station_sensors_heading"),summary:d,resetLabel:o("reset_section"),body:h})}(this,b)}
        ${function(t,a){const{t:o,cfg:n,fcfg:i,showsStation:s,showsForecast:r}=a,l=[{name:"",type:"grid",schema:[...s?[{name:"days",selector:{number:{min:1,max:14,mode:"box"}}}]:[],...r?[{name:"forecast_days",selector:{number:{min:1,max:14,mode:"box"}}}]:[]]}],c=[{name:"style",selector:{select:{mode:"dropdown",options:[{value:"style2",label:o("chart_style_without_boxes")},{value:"style1",label:o("chart_style_with_boxes")}]}}},{name:"round_temp",selector:{boolean:{}}},{name:"disable_animation",selector:{boolean:{}}}],d={days:o("days"),forecast_days:o("forecast_days"),number_of_forecasts:o("number_of_forecasts"),chart_height:o("chart_height"),style:o("chart_style"),round_temp:o("round_temp"),disable_animation:o("disable_animation")},h=e=>d[e.name]||o(e.name),u=function(e){return S.filter(({path:t,def:a})=>{const o=e[A(t)];return a?!1!==o:!0===o}).map(({path:e})=>A(e))}(i),p=[...s?[String(n.days??7)]:[],...r?[String(n.forecast_days??7)]:[]].join("+"),_=i.number_of_forecasts??8,f=`${p} ${o("summary_days")} · ${_} ${o("summary_columns")} · ${u.length} ${o("summary_rows")}`,m=e`
    <h4 class="subsection">${o("chart_time_range_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{days:n.days,forecast_days:n.forecast_days}}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${h}
        @value-changed=${t._chartTopChanged}
      ></ha-form>
      <ha-form
        .data=${{number_of_forecasts:i.number_of_forecasts,chart_height:i.chart_height}}
        .schema=${[{name:"",type:"grid",schema:[{name:"number_of_forecasts",selector:{number:{min:0,mode:"box"}}},{name:"chart_height",selector:{number:{min:80,max:600,mode:"box"}}}]}]}
        .hass=${t.hass}
        .computeLabel=${h}
        @value-changed=${t._chartForecastChanged}
      ></ha-form>
      <p class="hint">${o("number_of_forecasts_helper")}</p>
    </div>

    <h4 class="subsection">${o("chart_rows_heading")}</h4>
    <div class="textfield-container">
      ${L({group:"chart_rows",options:S.map(({path:e,labelKey:t})=>({value:A(e),label:o(t)})),selected:u,onChange:e=>{t._applyTogglePaths(S,e)}})}
      ${!0===i.show_sunshine?e`
        <div class="hint">${o("show_chart_sunshine_hint")}</div>
        <div>${t._renderSunshineAvailabilityHint(n,o)}</div>
      `:""}
      ${!0===i.show_precip_probability?e`
        <div class="hint">${o("show_chart_precip_probability_hint")}</div>
      `:""}
    </div>

    <h4 class="subsection">${o("chart_appearance_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{style:i.style||"style2",round_temp:!0===i.round_temp,disable_animation:!0===i.disable_animation}}
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
  `;return x({editor:t,sectionKey:"chart",icon:"mdi:chart-line",title:o("chart_section_heading"),summary:f,resetLabel:o("reset_section"),body:m})}(this,b)}
        ${function(t,a){const{t:o,cfg:l,hasSensor:c,hasLiveValue:d}=a,h=!0===l.show_main,u=!0===l.show_attributes,p=e=>[{name:e,selector:{boolean:{}}}],_=[{name:"clock_mode",selector:{select:{mode:"dropdown",options:M.map(e=>({value:e,label:o(`clock_${e}`)}))}}}],f=[{name:"time_format",selector:{select:{mode:"dropdown",options:D.map(e=>({value:e,label:o(`clock_${e}`)}))}}}],m=function(e,t){return F.filter(({gate:a,gateKey:o,requireAll:n})=>{if(!a||!o)return!0;const i="string"==typeof o?[o]:o,s="live"===a?e:t;return n?i.every(s):i.some(s)})}(d,c),g=e=>({show_main:o("show_main"),show_attributes:o("show_attributes"),clock_mode:o("clock_label"),time_format:o("time_format_label")}[e.name]||o(e.name)),y=n(t.hass)?e`<div class="hint">${o("next_rain_enable_hint")}</div>`:"",b=function(e,t){const a=new Set(i(e).flat());return t.filter(({path:e})=>{const t=s(e);return void 0!==t&&a.has(t)}).map(({path:e})=>e)}(l,m),v=function(t,a,o){const{t:n,cfg:l}=a,c=new Set(o.map(s).filter(e=>void 0!==e)),d=i(l).map(e=>e.filter(e=>c.has(e))).filter(e=>e.length>0);return 0===d.length?e``:T({layout:d,explicit:r(l),labelFor:e=>J(n,`show_${e}`),t:n,onChange:e=>t._setAttributesLayout(e),onReset:()=>t._setAttributesLayout(null),rerender:()=>t.requestUpdate()})}(t,a,b),w=`${o("main_panel_heading")} ${o(h?"summary_on":"summary_off")} · `+(u?`${b.length} ${o("summary_attributes")}`:`${o("attributes_heading")} ${o("summary_off")}`),$=e`
    <div class="textfield-container">
      <ha-form
        .data=${{show_main:h}}
        .schema=${p("show_main")}
        .hass=${t.hass}
        .computeLabel=${g}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
      ${h?e`
        <div class="gated">
          ${L({label:o("main_elements_label"),group:"main_elements",options:E.map(({path:e})=>({value:e,label:o(e)})),selected:B(l,E),onChange:e=>t._applyTogglePaths(E,e)})}
          <ha-form
            .data=${{clock_mode:t._clockMode}}
            .schema=${_}
            .hass=${t.hass}
            .computeLabel=${g}
            @value-changed=${e=>{const a=e.detail.value?.clock_mode;a&&a!==t._clockMode&&t._setClockMode(a)}}
          ></ha-form>
        </div>
      `:""}

      <div class="divider"></div>

      <ha-form
        .data=${{show_attributes:u}}
        .schema=${p("show_attributes")}
        .hass=${t.hass}
        .computeLabel=${g}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
      ${u?e`
        <div class="gated">
          ${L({label:o("attributes_heading"),group:"attributes",options:m.map(({path:e})=>({value:e,label:J(o,e)})),selected:b,onChange:e=>t._applyAttributeToggles(m,e)})}
          ${v}
          <h4 class="subsection">${o("time_format_scope")}</h4>
          <ha-form
            .data=${{time_format:t._timeFormat}}
            .schema=${f}
            .hass=${t.hass}
            .computeLabel=${g}
            @value-changed=${e=>{const a=e.detail.value?.time_format;a&&a!==t._timeFormat&&t._setTimeFormat(a)}}
          ></ha-form>
          <div class="hint">${o("time_format_hint")}</div>
          ${y}
        </div>
      `:""}
    </div>
  `;return x({editor:t,sectionKey:"live_panel",icon:"mdi:clock-outline",title:o("live_panel_heading"),summary:w,resetLabel:o("reset_section"),body:$})}(this,b)}
        ${function(t,a){const{t:o,cfg:n}=a,i="object"==typeof n.location&&null!==n.location?n.location:{},s="string"==typeof i.time_zone?i.time_zone:"",r=function(){const e=Intl.supportedValuesOf;if("function"!=typeof e)return null;try{return e.call(Intl,"timeZone")}catch{return null}}(),l=[{name:"latitude",selector:{number:{min:-90,max:90,step:"any",mode:"box"}}},{name:"longitude",selector:{number:{min:-180,max:180,step:"any",mode:"box"}}},{name:"time_zone",selector:r?{select:{mode:"dropdown",custom_value:!1,options:(s&&!r.includes(s)?[s,...r]:r).map(e=>({value:e,label:e}))}}:{text:{}}}],c="string"==typeof n.time_zone&&""!==n.time_zone?n.time_zone:"server",d=[{value:"server",label:o("time_zone_server")},{value:"location",label:o("time_zone_location")}];d.some(e=>e.value===c)||d.push({value:c,label:c});const h=[{name:"time_zone",selector:{select:{mode:"dropdown",options:d}}}],u={latitude:o("location_latitude"),longitude:o("location_longitude")},p="number"==typeof i.latitude&&"number"==typeof i.longitude,_=p||s?[p?`${i.latitude}, ${i.longitude}`:"",s].filter(Boolean).join(" · "):o("location_summary_home"),f=e`
    <div class="textfield-container">
      <ha-form
        .data=${{latitude:i.latitude,longitude:i.longitude,time_zone:s||void 0}}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${e=>"time_zone"===e.name?o("location_time_zone"):u[e.name]}
        @value-changed=${t._locationChanged}
      ></ha-form>
      <ha-form
        .data=${{time_zone:c}}
        .schema=${h}
        .hass=${t.hass}
        .computeLabel=${()=>o("time_zone_label")}
        @value-changed=${t._timeZoneModeChanged}
      ></ha-form>
      <div class="hint">${o("location_hint")}</div>
    </div>
  `;return x({editor:t,sectionKey:"location",icon:"mdi:map-marker",title:o("location_heading"),summary:_,resetLabel:o("reset_section"),body:f})}(this,b)}
        ${function(t,a){const{t:o,unitsConfig:n}=a,i=[n.pressure||"hPa",n.speed||"km/h",n.precipitation||"mm"].join(" · "),s=e`
    <div class="textfield-container">
      <ha-form
        .data=${n}
        .schema=${R}
        .hass=${t.hass}
        .computeLabel=${e=>({pressure:o("unit_pressure_label"),speed:o("unit_speed_label"),precipitation:o("unit_precipitation_label")}[e.name]||e.name)}
        @value-changed=${t._unitsChanged}
      ></ha-form>
    </div>
  `;return x({editor:t,sectionKey:"units",icon:"mdi:ruler",title:o("units_heading"),summary:i,resetLabel:o("reset_section"),body:s})}(this,b)}
        ${function(t,a){const{t:o,cfg:n}=a,i=n.tap_action?.action||"none",s=`${o("tap_action_label")}: ${i}`,r=e`
    <div class="textfield-container">
      ${[["tap_action","tap_action_label"],["hold_action","hold_action_label"],["double_tap_action","double_tap_action_label"]].map(([a,i])=>e`
        <ha-selector
          .hass=${t.hass}
          .selector=${{ui_action:{}}}
          .value=${n[a]}
          .label=${o(i)}
          @value-changed=${e=>t._actionChanged(a,e.detail.value)}
        ></ha-selector>
      `)}
    </div>
  `;return x({editor:t,sectionKey:"actions",icon:"mdi:gesture-tap",title:o("actions_section_heading"),summary:s,resetLabel:o("reset_section"),body:r})}(this,b)}
        <div class="editor-footer">
          <a href="https://github.com/chriguschneider/weather-station-card/blob/master/docs/CONFIGURATION.md"
             target="_blank" rel="noopener noreferrer">
            📖 ${t("open_documentation")}
          </a>
        </div>
      </div>
    `}});
