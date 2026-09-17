import{b as e,A as t,n as a,r as o,t as s,h as n,i,a as r,c as l,d as c,s as d,e as h,f as p,D as u,l as _}from"./main-CyeWbuLq.js";const f=[{name:"weather_entity",required:!0,selector:{entity:{domain:"weather"}}}];function m(t){const{editor:a,sectionKey:o,icon:s,title:n,summary:i,resetLabel:r,body:l}=t;return e`
    <ha-expansion-panel
      outlined
      class="editor-panel"
      .expanded=${a._isPanelExpanded(o)}
      @expanded-changed=${e=>a._setPanelExpanded(o,!0===e.detail?.expanded)}
    >
      <div slot="header" class="panel-header">
        <ha-icon class="panel-icon" .icon=${s}></ha-icon>
        <div class="panel-titles">
          <div class="panel-title">${n}</div>
          <div class="panel-summary">${i}</div>
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
  `}const g=new Set(["temperature"]);function y(e){const t=e?.states?Object.entries(e.states).filter(([,e])=>!!e):[],a=e=>t.filter(([t,a])=>t.startsWith("sensor.")&&e.includes(a.attributes?.device_class||"")).map(([e])=>e),o=t.filter(([e,t])=>e.startsWith("sensor.")&&("°"===t.attributes?.unit_of_measurement||"deg"===t.attributes?.unit_of_measurement)).map(([e])=>e),s=/^(mm|in|inch|inches|")\/(h|hr|hour)$/i,n=t.filter(([e,t])=>e.startsWith("sensor.")&&("precipitation_intensity"===t.attributes?.device_class||s.test(t.attributes?.unit_of_measurement||""))).map(([e])=>e),i=/zero[._ -]?degree|freezing[._ -]?level|nullgrad|snow[._ -]?line/i,r=t.filter(([e,t])=>e.startsWith("sensor.")&&(i.test(e)||i.test(t.attributes?.friendly_name||""))).map(([e])=>e),l=/(?:^|[._-])uv(?:[._-]|index|$)/i,c=/\buv[\s_-]?index\b|\buv\b/i,d=t.filter(([e,t])=>{if(!e.startsWith("sensor."))return!1;const a=t.attributes?.friendly_name||"";return l.test(e)||c.test(a)}).map(([e])=>e);return[{key:"temperature",candidates:a(["temperature"])},{key:"pressure",candidates:a(["atmospheric_pressure","pressure"])},{key:"humidity",candidates:a(["humidity"])},{key:"dew_point",candidates:a(["temperature"])},{key:"precipitation",candidates:a(["precipitation"])},{key:"precipitation_rate",candidates:n},{key:"wind_speed",candidates:a(["wind_speed","speed"])},{key:"gust_speed",candidates:a(["wind_speed","speed"])},{key:"wind_direction",candidates:o},{key:"illuminance",candidates:a(["illuminance","irradiance"])},{key:"uv_index",candidates:d},{key:"sunshine_duration",candidates:[]},{key:"zero_degree_level",candidates:r}]}function b(t){const{label:a,options:o,selected:s,onChange:n,group:i}=t,r=new Set(s);return e`
    <div class="pill-field">
      ${a?e`<div class="pill-label">${a}</div>`:""}
      <div class="pills" data-group=${i}>
        ${o.map(t=>{const a=r.has(t.value);return e`
            <button
              type="button"
              class="pill ${a?"on":""}"
              role="switch"
              aria-checked=${a?"true":"false"}
              data-value=${t.value}
              @click=${()=>(e=>{const t=new Set(r);t.has(e)?t.delete(e):t.add(e),n(o.map(e=>e.value).filter(e=>t.has(e)))})(t.value)}
            >${t.label}</button>
          `})}
      </div>
    </div>
  `}const v=[{path:"forecast.condition_icons",def:!0,labelKey:"show_chart_icons"},{path:"forecast.show_wind_arrow",def:!0,labelKey:"show_chart_wind_direction"},{path:"forecast.show_wind_speed",def:!0,labelKey:"show_chart_wind_speed"},{path:"forecast.show_date",def:!0,labelKey:"show_chart_date"},{path:"forecast.show_sunshine",def:!1,labelKey:"show_chart_sunshine"},{path:"forecast.show_mode_toggle",def:!0,labelKey:"show_chart_mode_toggle"}],w=e=>e.split(".").pop();function $(e,t,a){const o=e.map(e=>e.filter(e=>e!==t));for(;o.length<=a.column;)o.push([]);const s=o[a.column];return s.splice(Math.max(0,Math.min(a.index,s.length)),0,t),o}function x(e,t,a){return e<t?t-e:e>a?e-a:0}const k={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right"};let C=null;function S(e,t){return JSON.stringify(e)===JSON.stringify(t)}function L(e){const t=C;if(!t)return;window.removeEventListener("pointermove",t.onMove),window.removeEventListener("pointerup",t.onUp),window.removeEventListener("pointercancel",t.onCancel),t.ghost?.remove(),C=null;const o=t.active&&!S(a(t.preview),a(t.base));e&&o?t.onChange(a(t.preview)):t.rerender()}function A(e,t){if(0!==e.button)return;C&&L(!1);const a=e.currentTarget,o=a.closest(".layout-board");if(!o)return;const s=a.getBoundingClientRect(),n={token:t.token,board:o,startX:e.clientX,startY:e.clientY,grabOffsetX:e.clientX-s.left,grabOffsetY:e.clientY-s.top,pillWidth:s.width,pillHeight:s.height,label:t.label,active:!1,base:t.layout,preview:t.layout,ghost:null,onChange:t.onChange,rerender:t.rerender,onMove:e=>{const t=C;if(!t)return;if(!t.active){const a=e.clientX-t.startX,o=e.clientY-t.startY;if(a*a+o*o<36)return;t.active=!0,t.ghost=function(e){const t=document.createElement("div");return t.textContent=e.label,t.setAttribute("aria-hidden","true"),Object.assign(t.style,{position:"fixed",left:"0",top:"0",width:`${e.pillWidth}px`,boxSizing:"border-box",padding:"7px 14px",borderRadius:"16px",fontSize:"13px",lineHeight:"1.2",fontFamily:"inherit",background:"var(--primary-color, #03a9f4)",color:"var(--text-primary-color, #fff)",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.3)",pointerEvents:"none",zIndex:"10000",opacity:"0.9"}),document.body.appendChild(t),t}(t),t.rerender()}e.preventDefault(),function(e,t,a){e.ghost&&(e.ghost.style.transform=`translate(${t-e.grabOffsetX}px, ${a-e.grabOffsetY}px)`)}(t,e.clientX,e.clientY);const a=function(e,t,a){if(0===t.length)return null;let o=0,s=1/0;t.forEach((t,a)=>{const n=function(e,t,a){const o=x(e,a.left,a.right),s=x(t,a.top,a.bottom);return o*o+s*s}(e.x,e.y,t.rect);n<s&&(s=n,o=a)});const n=t[o].pills.filter(e=>e.token!==a).filter(t=>(t.rect.top+t.rect.bottom)/2<e.y).length;return{column:o,index:n}}({x:e.clientX,y:e.clientY},function(e){return Array.from(e.querySelectorAll("[data-col]")).map(e=>({rect:e.getBoundingClientRect(),pills:Array.from(e.querySelectorAll("[data-token]")).map(e=>({token:e.dataset.token,rect:e.getBoundingClientRect()}))}))}(t.board),t.token);if(!a)return;const o=$(t.base,t.token,a);S(o,t.preview)||(t.preview=o,t.rerender())},onUp:()=>L(!0),onCancel:()=>L(!1)};C=n,window.addEventListener("pointermove",n.onMove),window.addEventListener("pointerup",n.onUp),window.addEventListener("pointercancel",n.onCancel)}function q(o){const{layout:s,explicit:n,labelFor:i,t:r,onChange:l,onReset:c,rerender:d}=o,h=C?.active?C.preview:s,p=C?.active?C.token:null,u=t=>e`
    <div
      class="pill on layout-pill ${t===p?"dragging":""}"
      data-token=${t}
      tabindex="0"
      role="option"
      aria-label=${i(t)}
      @pointerdown=${e=>A(e,{token:t,label:i(t),layout:s,onChange:l,rerender:d})}
      @keydown=${e=>((e,t)=>{const o=k[e.key];if(!o)return;e.preventDefault();const n=function(e,t,o){const s=e.findIndex(e=>e.includes(t));if(s<0)return e;const n=e[s].indexOf(t);let i;switch(o){case"up":if(0===n)return e;i={column:s,index:n-1};break;case"down":if(n>=e[s].length-1)return e;i={column:s,index:n+1};break;case"left":if(0===s)return e;i={column:s-1,index:Math.min(n,e[s-1].length)};break;case"right":if(s===e.length-1&&1===e[s].length)return e;i={column:s+1,index:Math.min(n,e[s+1]?.length??0)}}return a($(e,t,i))}(s,t,o);if(n===s)return;l(n);const i=e.currentTarget.closest(".layout-board");requestAnimationFrame(()=>{i?.querySelector(`[data-token="${t}"]`)?.focus()})})(e,t)}
    ><ha-icon icon="mdi:drag-vertical"></ha-icon><span>${i(t)}</span></div>
  `;return e`
    <div class="pill-field">
      <div class="pill-label">${r("layout_board_label")}</div>
      <div class="layout-board" role="listbox" aria-label=${r("layout_board_label")}>
        ${h.map((t,a)=>e`
          <div class="layout-col ${0===t.length?"empty":""}" data-col=${a}>
            ${t.map(u)}
          </div>
        `)}
        <div class="layout-col new" data-col=${h.length}>
          <span>${r("layout_board_new_column")}</span>
        </div>
      </div>
      <div class="hint">${r("layout_board_hint")}</div>
      ${n?e`
        <button type="button" class="link-button" @click=${c}>${r("layout_board_reset")}</button>
      `:t}
    </div>
  `}const O=[{path:"show_temperature",def:!0},{path:"show_current_condition",def:!1},{path:"show_day",def:!1},{path:"show_date",def:!1}],z=[{path:"show_pressure",def:!0,gate:"live",gateKey:"pressure"},{path:"show_dew_point_humidity",def:!1,gate:"live",gateKey:["dew_point","humidity"],requireAll:!0},{path:"show_dew_point",def:!1,gate:"live",gateKey:"dew_point"},{path:"show_humidity",def:!1,gate:"live",gateKey:"humidity"},{path:"show_precipitation",def:!0,gate:"sensor",gateKey:["precipitation","precipitation_rate"]},{path:"show_zero_degree_level",def:!1,gate:"sensor",gateKey:"zero_degree_level"},{path:"show_uv_illuminance",def:!1,gate:"live",gateKey:["uv_index","illuminance"],requireAll:!0},{path:"show_uv_index",def:!0,gate:"live",gateKey:"uv_index"},{path:"show_illuminance",def:!1,gate:"sensor",gateKey:"illuminance"},{path:"show_wind_direction",def:!0,gate:"live",gateKey:"wind_direction"},{path:"show_wind_speed",def:!0,gate:"live",gateKey:"wind_speed"},{path:"show_wind_gust_speed",def:!1,gate:"live",gateKey:"gust_speed"},{path:"show_sun",def:!1},{path:"show_moon",def:!0}],K=["off","24h","24h_seconds","12h","12h_seconds"];function P(e,t){return t.filter(({path:t,def:a})=>a?!1!==e[t]:!0===e[t]).map(({path:e})=>e)}function U(e,t){const a=t.split(".").pop()??t;return"show_dew_point_humidity"===a?`${e("show_dew_point")} + ${e("show_humidity")}`:"show_uv_illuminance"===a?`${e("show_uv_index")} + ${e("show_illuminance")}`:e(a)}const N=[{name:"",type:"grid",schema:[{name:"pressure",selector:{select:{mode:"dropdown",options:["hPa","mmHg","inHg"]}}},{name:"speed",selector:{select:{mode:"dropdown",options:["km/h","m/s","mph","Bft"]}}},{name:"precipitation",selector:{select:{mode:"dropdown",options:["mm","in"]}}}]}],j={basics:["show_station","show_forecast","forecast.type","title","weather_entity"],sensors:["sensors","forecast.openmeteo_history"],chart:["days","forecast_days","forecast.number_of_forecasts","forecast.chart_height","forecast.condition_icons","forecast.show_wind_arrow","forecast.show_wind_speed","forecast.show_date","forecast.show_sunshine","forecast.show_mode_toggle","forecast.style","forecast.round_temp","forecast.disable_animation"],live_panel:["show_main","show_temperature","show_current_condition","show_time","show_time_seconds","use_12hour_format","show_day","show_date","show_attributes","show_humidity","show_pressure","show_dew_point","show_precipitation","show_uv_index","show_illuminance","show_wind_direction","show_wind_speed","show_wind_gust_speed","show_sun","show_moon","show_zero_degree_level","show_dew_point_humidity","show_uv_illuminance","attributes_layout"],units:["units"],actions:["tap_action","hold_action","double_tap_action"]};customElements.define("weather-station-card-editor",class extends i{constructor(){super(...arguments),this.hass=null,this._config=null,this._setPastSource=e=>{if(!this._config)return;const t={...this._config},a={...t.forecast??{}};"openmeteo"===e?(a.openmeteo_history=!0,t.forecast=a,delete t.sensors):(delete a.openmeteo_history,0===Object.keys(a).length?delete t.forecast:t.forecast=a),this.configChanged(t),this.requestUpdate()},this._setClockMode=e=>{const t=[];"off"!==e&&t.push("show_time"),e.endsWith("_seconds")&&t.push("show_time_seconds"),e.startsWith("12h")&&t.push("use_12hour_format"),this._applyTogglePaths([{path:"show_time",def:!1},{path:"show_time_seconds",def:!1},{path:"use_12hour_format",def:!1}],t)},this._applyTogglePaths=(e,t)=>{if(!this._config)return;const a=new Set(t),o=JSON.parse(JSON.stringify(this._config));for(const{path:t,def:s}of e){const e=t.split(".").pop(),n=a.has(e);n===s?this._deleteByPath(o,t):this._setByPath(o,t,n)}this.configChanged(o),this.requestUpdate()},this._applyAttributeToggles=(e,t)=>{if(!this._config)return;const a=new Set(t),n=JSON.parse(JSON.stringify(this._config));let i=o(this._config);for(const{path:t}of e){const e=s(t);if(!e)continue;const o=t.split(".").pop();i=a.has(o)?r(i,e):l(i,e)}this._setAttributesLayout(i,n)},this._setAttributesLayout=(e,t)=>{if(!this._config)return;const s=t??JSON.parse(JSON.stringify(this._config));if(null===e){const e=new Set(o(this._config).flat());delete s.attributes_layout;for(const t of c){const a=d(t),o=!0===u[a],n=e.has(t);n===o?delete s[a]:s[a]=n}}else{s.attributes_layout=a(e);for(const e of c)delete s[d(e)]}this.configChanged(s),this.requestUpdate()},this._expandedPanels={},this._sensorsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail;this.configChanged({...this._config,sensors:a.value}),this.requestUpdate()},this._sensorPickerChanged=(e,t)=>{if(!this._config)return;const a={...this._config.sensors||{}};""===t||null==t?delete a[e]:a[e]=t,this.configChanged({...this._config,sensors:a}),this.requestUpdate()},this._unitsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail;this.configChanged({...this._config,units:a.value}),this.requestUpdate()},this._chartTopChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,o={...this._config};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged(o),this.requestUpdate()},this._chartForecastChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,o={...this._config.forecast||{}};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged({...this._config,forecast:o}),this.requestUpdate()},this._livePanelChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,o={...this._config};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged(o),this.requestUpdate()},this._resetSection=e=>{if(!this._config)return;const t=j[e];if(!t)return;const a=JSON.parse(JSON.stringify(this._config));for(const e of t)this._deleteByPath(a,e);this.configChanged(a),this.requestUpdate()},this._valueChanged=(e,t)=>{if(!this._config)return;const a={...this._config},o=e.target.checked??e.target.value;if(t.includes(".")){const e=t.split(".");let s=a;for(let t=0;t<e.length-1;t++)s[e[t]]={...s[e[t]]},s=s[e[t]];s[e[e.length-1]]=o}else a[t]=o;this.configChanged(a),this.requestUpdate()},this._actionChanged=(e,t)=>{if(!this._config)return;const a={...this._config};null==t?delete a[e]:a[e]=t,this.configChanged(a),this.requestUpdate()}}static get properties(){return{_config:{type:Object},hass:{type:Object}}}setConfig(e){if(!e)throw new Error("Invalid configuration");this._config=e;const t=this.hass?.language||"en";"en"!==t&&"en"!==t.split("-")[0]&&h(t).then(()=>this.requestUpdate()),this.requestUpdate()}get config(){return this._config}get _mode(){if(!this._config)return"station";const e=!1!==this._config.show_station,t=!0===this._config.show_forecast;return e&&t?"combination":t?"forecast":"station"}_setMode(e){if(!this._config)return;const t={...this._config};switch(e){case"station":t.show_station=!0,t.show_forecast=!1;break;case"forecast":t.show_station=!1,t.show_forecast=!0;break;case"combination":t.show_station=!0,t.show_forecast=!0}this.configChanged(t),this.requestUpdate()}get _pastSource(){const e=this._config?.sensors||{};if(Object.values(e).some(e=>"string"==typeof e&&""!==e.trim()))return"station";const t=this._config?.forecast;return!0===t?.openmeteo_history?"openmeteo":"station"}get _clockMode(){const e=this._config??{};return!0!==e.show_time?"off":(!0===e.use_12hour_format?"12h":"24h")+(!0===e.show_time_seconds?"_seconds":"")}_setByPath(e,t,a){const o=t.split(".");let s=e;for(let e=0;e<o.length-1;e++){const t=s[o[e]];t&&"object"==typeof t||(s[o[e]]={}),s=s[o[e]]}s[o[o.length-1]]=a}_isPanelExpanded(e){return!0===this._expandedPanels[e]}_setPanelExpanded(e,t){this._expandedPanels[e]=t}_pastDataAvailable(){if(!this._config)return!0;const e=this._config.sensors||{},t=Object.values(e).some(e=>"string"==typeof e&&""!==e.trim()),a=this._config.forecast;return t||!0===a?.openmeteo_history}updated(e){e.has("_config")&&this._config&&!this._pastDataAvailable()&&"forecast"!==this._mode&&this._setMode("forecast")}configChanged(e){const t=new Event("config-changed",{bubbles:!0,composed:!0});t.detail={config:e},this.dispatchEvent(t)}_deleteByPath(e,t){const a=t.split("."),o=[e];let s=e;for(let e=0;e<a.length-1;e++){const t=s?.[a[e]];if(!t||"object"!=typeof t)return;s=t,o.push(s)}delete s[a[a.length-1]];for(let e=o.length-1;e>0;e--){const t=o[e];if(!t||0!==Object.keys(t).length)break;delete o[e-1][a[e-1]]}}_renderSunshineAvailabilityHint(t,a){const o=t&&t.forecast;if(!0!==o?.show_sunshine)return"";const s=this.hass,n=s?.config?s.config.latitude:null,i=s?.config?s.config.longitude:null;if(!Number.isFinite(n)||!Number.isFinite(i))return"";const r=p(n,i);if(!r)return e`<div class="hint" style="margin-top:4px;">
        ${a("sunshine_availability_pending")}
      </div>`;const l=parseInt(String(t.forecast_days??(t.days||7)),10),c=Number.isFinite(l)&&r.forecastDays>0&&l>r.forecastDays,d=(a("sunshine_availability")||"Sunshine: {past} past, {future} forecast days available").replace("{past}",String(r.pastDays)).replace("{future}",String(r.forecastDays));return e`
      <div class="hint" style="margin-top:4px;">
        ${d}
        ${c?e`<br/>${(a("sunshine_availability_warning")||"Configured forecast_days ({req}) exceeds available — last {gap} columns will have empty sunshine bars.").replace("{req}",String(l)).replace("{gap}",String(l-r.forecastDays))}`:""}
      </div>
    `}render(){const t=e=>function(e,t){const a=e?.language||"en",o=a.split("-")[0];for(const e of[a,o,"en"]){const a=_[e]?.editor;if(a&&"string"==typeof a[t])return a[t]}return t}(this.hass,e),a=this._config??{},i=a.forecast??{},r=a.sensors??{},l=a.units??{},c=this._mode,d="combination"===c,h="forecast"===c||d,p="station"===c||d,u={humidity:"humidity",pressure:"pressure",dew_point:"dew_point",uv_index:"uv_index",wind_direction:"wind_bearing",wind_speed:"wind_speed",gust_speed:"wind_gust_speed"},$="string"==typeof a.weather_entity?a.weather_entity:"",x=$?this.hass?.states?.[$]:void 0,k=x?.attributes??{},C=this._pastDataAvailable(),S={t:t,cfg:a,fcfg:i,sensorsConfig:r,unitsConfig:l,mode:c,showsStation:p,showsForecast:h,hasSensor:e=>!!r[e],hasLiveValue:e=>{if(r[e])return!0;const t=u[e];if(!t)return!1;return null!=k[t]},pastDataAvailable:C};return e`
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
        ${function(t,a){const{t:o,cfg:s,fcfg:n,mode:i,showsForecast:r,pastDataAvailable:l}=a,c=[{name:"mode",selector:{select:{mode:"dropdown",options:[{value:"combination",label:o("mode_combination")},{value:"station",label:o("mode_station")},{value:"forecast",label:o("mode_forecast")}]}}}],d=[{name:"type",selector:{select:{mode:"dropdown",options:[{value:"daily",label:o("forecast_type_daily")},{value:"today",label:o("forecast_type_today")},{value:"hourly",label:o("forecast_type_hourly")}]}}}];return e`
    <div class="textfield-container">
      <ha-form
        .data=${{mode:i}}
        .schema=${c}
        .hass=${t.hass}
        .disabled=${!l}
        .computeLabel=${()=>o("mode_label")}
        @value-changed=${e=>{const a=e.detail.value?.mode;a&&a!==i&&t._setMode(a)}}
      ></ha-form>

      <div class="grid2">
        <ha-form
          .data=${{type:n.type||"daily"}}
          .schema=${d}
          .hass=${t.hass}
          .computeLabel=${()=>o("chart_type_label")}
          @value-changed=${e=>{const a=e.detail.value?.type;a&&a!==n.type&&t._valueChanged({target:{value:a}},"forecast.type")}}
        ></ha-form>
        <ha-form
          .data=${{title:s.title||""}}
          .schema=${[{name:"title",selector:{text:{}}}]}
          .hass=${t.hass}
          .computeLabel=${()=>o("title")}
          @value-changed=${t._chartTopChanged}
        ></ha-form>
      </div>

      ${r?e`
        <ha-form
          .data=${{weather_entity:s.weather_entity||""}}
          .schema=${f}
          .hass=${t.hass}
          .computeLabel=${()=>o("weather_entity")}
          @value-changed=${e=>{const a=e.detail.value?.weather_entity??"";t._valueChanged({target:{value:a}},"weather_entity")}}
        ></ha-form>
      `:""}
    </div>
  `}(this,S)}
        ${function(t,a){const{t:o,sensorsConfig:s,pastDataAvailable:n,showsStation:i}=a;if(!i&&n)return e``;const r=t._pastSource,l=[{name:"past_source",selector:{select:{mode:"dropdown",options:[{value:"station",label:o("past_source_station")},{value:"openmeteo",label:o("past_source_openmeteo")}]}}}],c=Object.values(s).filter(e=>"string"==typeof e&&""!==e.trim()).length,d="openmeteo"===r?o("summary_openmeteo"):c>0?o("summary_connected").replace("{n}",String(c)):o("summary_no_sensors"),h=e`
    ${n?"":e`
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
          .data=${s}
          .schema=${p=t.hass,[{name:"",type:"grid",schema:y(p).map(e=>({name:e.key,required:g.has(e.key),selector:{entity:e.candidates.length>0?{include_entities:e.candidates}:{domain:"sensor"}}}))}]}
          .hass=${t.hass}
          .computeLabel=${e=>{const t=o(e.name);return e.required?`${t} (${o("required_marker")})`:t}}
          @value-changed=${t._sensorsChanged}
        ></ha-form>
      `}
    </div>
  `;var p;return m({editor:t,sectionKey:"sensors",icon:"mdi:thermometer",title:o("station_sensors_heading"),summary:d,resetLabel:o("reset_section"),body:h})}(this,S)}
        ${function(t,a){const{t:o,cfg:s,fcfg:n,showsStation:i,showsForecast:r}=a,l=[{name:"",type:"grid",schema:[...i?[{name:"days",selector:{number:{min:1,max:14,mode:"box"}}}]:[],...r?[{name:"forecast_days",selector:{number:{min:1,max:14,mode:"box"}}}]:[]]}],c=[{name:"style",selector:{select:{mode:"dropdown",options:[{value:"style2",label:o("chart_style_without_boxes")},{value:"style1",label:o("chart_style_with_boxes")}]}}},{name:"round_temp",selector:{boolean:{}}},{name:"disable_animation",selector:{boolean:{}}}],d={days:o("days"),forecast_days:o("forecast_days"),number_of_forecasts:o("number_of_forecasts"),chart_height:o("chart_height"),style:o("chart_style"),round_temp:o("round_temp"),disable_animation:o("disable_animation")},h=e=>d[e.name]||o(e.name),p=function(e){return v.filter(({path:t,def:a})=>{const o=e[w(t)];return a?!1!==o:!0===o}).map(({path:e})=>w(e))}(n),u=[...i?[String(s.days??7)]:[],...r?[String(s.forecast_days??7)]:[]].join("+"),_=n.number_of_forecasts??8,f=`${u} ${o("summary_days")} · ${_} ${o("summary_columns")} · ${p.length} ${o("summary_rows")}`,g=e`
    <h4 class="subsection">${o("chart_time_range_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{days:s.days,forecast_days:s.forecast_days}}
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
      <p class="hint">${o("number_of_forecasts_helper")}</p>
    </div>

    <h4 class="subsection">${o("chart_rows_heading")}</h4>
    <div class="textfield-container">
      ${b({group:"chart_rows",options:v.map(({path:e,labelKey:t})=>({value:w(e),label:o(t)})),selected:p,onChange:e=>{t._applyTogglePaths(v,e)}})}
      ${!0===n.show_sunshine?e`
        <div class="hint">${o("show_chart_sunshine_hint")}</div>
        <div>${t._renderSunshineAvailabilityHint(s,o)}</div>
      `:""}
    </div>

    <h4 class="subsection">${o("chart_appearance_heading")}</h4>
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
  `;return m({editor:t,sectionKey:"chart",icon:"mdi:chart-line",title:o("chart_section_heading"),summary:f,resetLabel:o("reset_section"),body:g})}(this,S)}
        ${function(t,a){const{t:i,cfg:r,hasSensor:l,hasLiveValue:c}=a,d=!0===r.show_main,h=!0===r.show_attributes,p=e=>[{name:e,selector:{boolean:{}}}],u=[{name:"clock_mode",selector:{select:{mode:"dropdown",options:K.map(e=>({value:e,label:i(`clock_${e}`)}))}}}],_=function(e,t){return z.filter(({gate:a,gateKey:o,requireAll:s})=>{if(!a||!o)return!0;const n="string"==typeof o?[o]:o,i="live"===a?e:t;return s?n.every(i):n.some(i)})}(c,l),f=e=>({show_main:i("show_main"),show_attributes:i("show_attributes"),clock_mode:i("clock_label")}[e.name]||i(e.name)),g=function(e,t){const a=new Set(o(e).flat());return t.filter(({path:e})=>{const t=s(e);return void 0!==t&&a.has(t)}).map(({path:e})=>e)}(r,_),y=function(t,a,i){const{t:r,cfg:l}=a,c=new Set(i.map(s).filter(e=>void 0!==e)),d=o(l).map(e=>e.filter(e=>c.has(e))).filter(e=>e.length>0);return 0===d.length?e``:q({layout:d,explicit:n(l),labelFor:e=>U(r,`show_${e}`),t:r,onChange:e=>t._setAttributesLayout(e),onReset:()=>t._setAttributesLayout(null),rerender:()=>t.requestUpdate()})}(t,a,g),v=`${i("main_panel_heading")} ${i(d?"summary_on":"summary_off")} · `+(h?`${g.length} ${i("summary_attributes")}`:`${i("attributes_heading")} ${i("summary_off")}`),w=e`
    <div class="textfield-container">
      <ha-form
        .data=${{show_main:d}}
        .schema=${p("show_main")}
        .hass=${t.hass}
        .computeLabel=${f}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
      ${d?e`
        <div class="gated">
          ${b({label:i("main_elements_label"),group:"main_elements",options:O.map(({path:e})=>({value:e,label:i(e)})),selected:P(r,O),onChange:e=>t._applyTogglePaths(O,e)})}
          <ha-form
            .data=${{clock_mode:t._clockMode}}
            .schema=${u}
            .hass=${t.hass}
            .computeLabel=${f}
            @value-changed=${e=>{const a=e.detail.value?.clock_mode;a&&a!==t._clockMode&&t._setClockMode(a)}}
          ></ha-form>
        </div>
      `:""}

      <div class="divider"></div>

      <ha-form
        .data=${{show_attributes:h}}
        .schema=${p("show_attributes")}
        .hass=${t.hass}
        .computeLabel=${f}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
      ${h?e`
        <div class="gated">
          ${b({label:i("attributes_heading"),group:"attributes",options:_.map(({path:e})=>({value:e,label:U(i,e)})),selected:g,onChange:e=>t._applyAttributeToggles(_,e)})}
          ${y}
        </div>
      `:""}
    </div>
  `;return m({editor:t,sectionKey:"live_panel",icon:"mdi:clock-outline",title:i("live_panel_heading"),summary:v,resetLabel:i("reset_section"),body:w})}(this,S)}
        ${function(t,a){const{t:o,unitsConfig:s}=a,n=[s.pressure||"hPa",s.speed||"km/h",s.precipitation||"mm"].join(" · "),i=e`
    <div class="textfield-container">
      <ha-form
        .data=${s}
        .schema=${N}
        .hass=${t.hass}
        .computeLabel=${e=>({pressure:o("unit_pressure_label"),speed:o("unit_speed_label"),precipitation:o("unit_precipitation_label")}[e.name]||e.name)}
        @value-changed=${t._unitsChanged}
      ></ha-form>
    </div>
  `;return m({editor:t,sectionKey:"units",icon:"mdi:ruler",title:o("units_heading"),summary:n,resetLabel:o("reset_section"),body:i})}(this,S)}
        ${function(t,a){const{t:o,cfg:s}=a,n=s.tap_action?.action||"none",i=`${o("tap_action_label")}: ${n}`,r=e`
    <div class="textfield-container">
      ${[["tap_action","tap_action_label"],["hold_action","hold_action_label"],["double_tap_action","double_tap_action_label"]].map(([a,n])=>e`
        <ha-selector
          .hass=${t.hass}
          .selector=${{ui_action:{}}}
          .value=${s[a]}
          .label=${o(n)}
          @value-changed=${e=>t._actionChanged(a,e.detail.value)}
        ></ha-selector>
      `)}
    </div>
  `;return m({editor:t,sectionKey:"actions",icon:"mdi:gesture-tap",title:o("actions_section_heading"),summary:i,resetLabel:o("reset_section"),body:r})}(this,S)}
        <div class="editor-footer">
          <a href="https://github.com/chriguschneider/weather-station-card/blob/master/docs/CONFIGURATION.md"
             target="_blank" rel="noopener noreferrer">
            📖 ${t("open_documentation")}
          </a>
        </div>
      </div>
    `}});
