import{b as e,i as t,e as a,r as s,l as o}from"./main-BgOJjzN5.js";const i=[{name:"weather_entity",required:!0,selector:{entity:{domain:"weather"}}}];function n(t){const{editor:a,sectionKey:s,icon:o,title:i,summary:n,resetLabel:r,body:c}=t;return e`
    <ha-expansion-panel
      outlined
      class="editor-panel"
      .expanded=${a._isPanelExpanded(s)}
      @expanded-changed=${e=>a._setPanelExpanded(s,!0===e.detail?.expanded)}
    >
      <div slot="header" class="panel-header">
        <ha-icon class="panel-icon" .icon=${o}></ha-icon>
        <div class="panel-titles">
          <div class="panel-title">${i}</div>
          <div class="panel-summary">${n}</div>
        </div>
        <ha-icon-button
          class="panel-reset"
          title=${r}
          aria-label=${r}
          @click=${e=>{e.stopPropagation(),a._resetSection(s)}}
        ><ha-icon icon="mdi:restore"></ha-icon></ha-icon-button>
      </div>
      <div class="panel-body">${c}</div>
    </ha-expansion-panel>
  `}const r=new Set(["temperature"]);function c(e){const t=e?.states?Object.entries(e.states).filter(([,e])=>!!e):[],a=e=>t.filter(([t,a])=>t.startsWith("sensor.")&&e.includes(a.attributes?.device_class||"")).map(([e])=>e),s=t.filter(([e,t])=>e.startsWith("sensor.")&&("°"===t.attributes?.unit_of_measurement||"deg"===t.attributes?.unit_of_measurement)).map(([e])=>e),o=/^(mm|in|inch|inches|")\/(h|hr|hour)$/i,i=t.filter(([e,t])=>e.startsWith("sensor.")&&("precipitation_intensity"===t.attributes?.device_class||o.test(t.attributes?.unit_of_measurement||""))).map(([e])=>e),n=/(?:^|[._-])uv(?:[._-]|index|$)/i,r=/\buv[\s_-]?index\b|\buv\b/i,c=t.filter(([e,t])=>{if(!e.startsWith("sensor."))return!1;const a=t.attributes?.friendly_name||"";return n.test(e)||r.test(a)}).map(([e])=>e);return[{key:"temperature",candidates:a(["temperature"])},{key:"pressure",candidates:a(["atmospheric_pressure","pressure"])},{key:"humidity",candidates:a(["humidity"])},{key:"dew_point",candidates:a(["temperature"])},{key:"wind_speed",candidates:a(["wind_speed","speed"])},{key:"gust_speed",candidates:a(["wind_speed","speed"])},{key:"precipitation",candidates:a(["precipitation"])},{key:"precipitation_rate",candidates:i},{key:"wind_direction",candidates:s},{key:"illuminance",candidates:a(["illuminance","irradiance"])},{key:"uv_index",candidates:c},{key:"sunshine_duration",candidates:[]}]}const h=[{path:"forecast.condition_icons",def:!0,labelKey:"show_chart_icons"},{path:"forecast.show_wind_arrow",def:!0,labelKey:"show_chart_wind_direction"},{path:"forecast.show_wind_speed",def:!0,labelKey:"show_chart_wind_speed"},{path:"forecast.show_date",def:!0,labelKey:"show_chart_date"},{path:"forecast.show_sunshine",def:!1,labelKey:"show_chart_sunshine"},{path:"forecast.show_mode_toggle",def:!0,labelKey:"show_chart_mode_toggle"}],d=e=>e.split(".").pop();const l=[{path:"show_temperature",def:!0},{path:"show_current_condition",def:!0},{path:"show_day",def:!1},{path:"show_date",def:!1}],_=[{path:"show_pressure",def:!0,gate:"live",gateKey:"pressure"},{path:"show_dew_point",def:!1,gate:"live",gateKey:"dew_point"},{path:"show_humidity",def:!1,gate:"live",gateKey:"humidity"},{path:"show_precipitation",def:!1,gate:"sensor",gateKey:["precipitation","precipitation_rate"]},{path:"show_uv_index",def:!0,gate:"live",gateKey:"uv_index"},{path:"show_illuminance",def:!1,gate:"sensor",gateKey:"illuminance"},{path:"show_sunshine_duration",def:!1,gate:"sensor",gateKey:"sunshine_duration"},{path:"show_wind_direction",def:!0,gate:"live",gateKey:"wind_direction"},{path:"show_wind_speed",def:!0,gate:"live",gateKey:"wind_speed"},{path:"show_wind_gust_speed",def:!1,gate:"live",gateKey:"gust_speed"},{path:"show_sun",def:!1},{path:"show_moon",def:!0}],p=["off","24h","24h_seconds","12h","12h_seconds"];function u(e,t){return t.filter(({path:t,def:a})=>a?!1!==e[t]:!0===e[t]).map(({path:e})=>e)}const m=[{name:"",type:"grid",schema:[{name:"pressure",selector:{select:{mode:"dropdown",options:["hPa","mmHg","inHg"]}}},{name:"speed",selector:{select:{mode:"dropdown",options:["km/h","m/s","mph","Bft"]}}},{name:"precipitation",selector:{select:{mode:"dropdown",options:["mm","in"]}}}]}],f={basics:["show_station","show_forecast","forecast.type","title","weather_entity"],sensors:["sensors","forecast.openmeteo_history"],chart:["days","forecast_days","forecast.number_of_forecasts","forecast.chart_height","forecast.condition_icons","forecast.show_wind_arrow","forecast.show_wind_speed","forecast.show_date","forecast.show_sunshine","forecast.show_mode_toggle","forecast.style","forecast.round_temp","forecast.disable_animation"],live_panel:["show_main","show_temperature","show_current_condition","show_time","show_time_seconds","use_12hour_format","show_day","show_date","show_attributes","show_humidity","show_pressure","show_dew_point","show_precipitation","show_uv_index","show_illuminance","show_sunshine_duration","show_wind_direction","show_wind_speed","show_wind_gust_speed","show_sun","show_moon"],units:["units"],actions:["tap_action","hold_action","double_tap_action"]};customElements.define("weather-station-card-editor",class extends t{constructor(){super(...arguments),this.hass=null,this._config=null,this._setPastSource=e=>{if(!this._config)return;const t={...this._config},a={...t.forecast??{}};"openmeteo"===e?(a.openmeteo_history=!0,t.forecast=a,delete t.sensors):(delete a.openmeteo_history,0===Object.keys(a).length?delete t.forecast:t.forecast=a),this.configChanged(t),this.requestUpdate()},this._setClockMode=e=>{const t=[];"off"!==e&&t.push("show_time"),e.endsWith("_seconds")&&t.push("show_time_seconds"),e.startsWith("12h")&&t.push("use_12hour_format"),this._applyTogglePaths([{path:"show_time",def:!1},{path:"show_time_seconds",def:!1},{path:"use_12hour_format",def:!1}],t)},this._applyTogglePaths=(e,t)=>{if(!this._config)return;const a=new Set(t),s=JSON.parse(JSON.stringify(this._config));for(const{path:t,def:o}of e){const e=t.split(".").pop(),i=a.has(e);i===o?this._deleteByPath(s,t):this._setByPath(s,t,i)}this.configChanged(s),this.requestUpdate()},this._expandedPanels={},this._sensorsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail;this.configChanged({...this._config,sensors:a.value}),this.requestUpdate()},this._sensorPickerChanged=(e,t)=>{if(!this._config)return;const a={...this._config.sensors||{}};""===t||null==t?delete a[e]:a[e]=t,this.configChanged({...this._config,sensors:a}),this.requestUpdate()},this._unitsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail;this.configChanged({...this._config,units:a.value}),this.requestUpdate()},this._chartTopChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,s={...this._config};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete s[e]:s[e]=t;this.configChanged(s),this.requestUpdate()},this._chartForecastChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,s={...this._config.forecast||{}};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete s[e]:s[e]=t;this.configChanged({...this._config,forecast:s}),this.requestUpdate()},this._livePanelChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const a=e.detail,s={...this._config};for(const[e,t]of Object.entries(a.value))void 0===t||""===t?delete s[e]:s[e]=t;this.configChanged(s),this.requestUpdate()},this._resetSection=e=>{if(!this._config)return;const t=f[e];if(!t)return;const a=JSON.parse(JSON.stringify(this._config));for(const e of t)this._deleteByPath(a,e);this.configChanged(a),this.requestUpdate()},this._valueChanged=(e,t)=>{if(!this._config)return;const a={...this._config},s=e.target.checked??e.target.value;if(t.includes(".")){const e=t.split(".");let o=a;for(let t=0;t<e.length-1;t++)o[e[t]]={...o[e[t]]},o=o[e[t]];o[e[e.length-1]]=s}else a[t]=s;this.configChanged(a),this.requestUpdate()},this._actionChanged=(e,t)=>{if(!this._config)return;const a={...this._config};null==t?delete a[e]:a[e]=t,this.configChanged(a),this.requestUpdate()}}static get properties(){return{_config:{type:Object},hass:{type:Object}}}setConfig(e){if(!e)throw new Error("Invalid configuration");this._config=e;const t=this.hass?.language||"en";"en"!==t&&"en"!==t.split("-")[0]&&a(t).then(()=>this.requestUpdate()),this.requestUpdate()}get config(){return this._config}get _mode(){if(!this._config)return"station";const e=!1!==this._config.show_station,t=!0===this._config.show_forecast;return e&&t?"combination":t?"forecast":"station"}_setMode(e){if(!this._config)return;const t={...this._config};switch(e){case"station":t.show_station=!0,t.show_forecast=!1;break;case"forecast":t.show_station=!1,t.show_forecast=!0;break;case"combination":t.show_station=!0,t.show_forecast=!0}this.configChanged(t),this.requestUpdate()}get _pastSource(){const e=this._config?.sensors||{};if(Object.values(e).some(e=>"string"==typeof e&&""!==e.trim()))return"station";const t=this._config?.forecast;return!0===t?.openmeteo_history?"openmeteo":"station"}get _clockMode(){const e=this._config??{};return!0!==e.show_time?"off":(!0===e.use_12hour_format?"12h":"24h")+(!0===e.show_time_seconds?"_seconds":"")}_setByPath(e,t,a){const s=t.split(".");let o=e;for(let e=0;e<s.length-1;e++){const t=o[s[e]];t&&"object"==typeof t||(o[s[e]]={}),o=o[s[e]]}o[s[s.length-1]]=a}_isPanelExpanded(e){return!0===this._expandedPanels[e]}_setPanelExpanded(e,t){this._expandedPanels[e]=t}_pastDataAvailable(){if(!this._config)return!0;const e=this._config.sensors||{},t=Object.values(e).some(e=>"string"==typeof e&&""!==e.trim()),a=this._config.forecast;return t||!0===a?.openmeteo_history}updated(e){e.has("_config")&&this._config&&!this._pastDataAvailable()&&"forecast"!==this._mode&&this._setMode("forecast")}configChanged(e){const t=new Event("config-changed",{bubbles:!0,composed:!0});t.detail={config:e},this.dispatchEvent(t)}_deleteByPath(e,t){const a=t.split("."),s=[e];let o=e;for(let e=0;e<a.length-1;e++){const t=o?.[a[e]];if(!t||"object"!=typeof t)return;o=t,s.push(o)}delete o[a[a.length-1]];for(let e=s.length-1;e>0;e--){const t=s[e];if(!t||0!==Object.keys(t).length)break;delete s[e-1][a[e-1]]}}_renderSunshineAvailabilityHint(t,a){const o=t&&t.forecast;if(!0!==o?.show_sunshine)return"";const i=this.hass,n=i?.config?i.config.latitude:null,r=i?.config?i.config.longitude:null;if(!Number.isFinite(n)||!Number.isFinite(r))return"";const c=s(n,r);if(!c)return e`<div class="hint" style="margin-top:4px;">
        ${a("sunshine_availability_pending")}
      </div>`;const h=parseInt(String(t.forecast_days??(t.days||7)),10),d=Number.isFinite(h)&&c.forecastDays>0&&h>c.forecastDays,l=(a("sunshine_availability")||"Sunshine: {past} past, {future} forecast days available").replace("{past}",String(c.pastDays)).replace("{future}",String(c.forecastDays));return e`
      <div class="hint" style="margin-top:4px;">
        ${l}
        ${d?e`<br/>${(a("sunshine_availability_warning")||"Configured forecast_days ({req}) exceeds available — last {gap} columns will have empty sunshine bars.").replace("{req}",String(h)).replace("{gap}",String(h-c.forecastDays))}`:""}
      </div>
    `}render(){const t=e=>function(e,t){const a=e?.language||"en",s=a.split("-")[0];for(const e of[a,s,"en"]){const a=o[e]?.editor;if(a&&"string"==typeof a[t])return a[t]}return t}(this.hass,e),a=this._config??{},s=a.forecast??{},f=a.sensors??{},g=a.units??{},y=this._mode,b="combination"===y,v="forecast"===y||b,w="station"===y||b,$={humidity:"humidity",pressure:"pressure",dew_point:"dew_point",uv_index:"uv_index",wind_direction:"wind_bearing",wind_speed:"wind_speed",gust_speed:"wind_gust_speed"},x="string"==typeof a.weather_entity?a.weather_entity:"",C=x?this.hass?.states?.[x]:void 0,k=C?.attributes??{},L=this._pastDataAvailable(),S={t:t,cfg:a,fcfg:s,sensorsConfig:f,unitsConfig:g,mode:y,showsStation:w,showsForecast:v,hasSensor:e=>!!f[e],hasLiveValue:e=>{if(f[e])return!0;const t=$[e];if(!t)return!1;return null!=k[t]},pastDataAvailable:L};return e`
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
        ${function(t,a){const{t:s,cfg:o,fcfg:n,mode:r,showsForecast:c,pastDataAvailable:h}=a,d=[{name:"mode",selector:{select:{mode:"dropdown",options:[{value:"combination",label:s("mode_combination")},{value:"station",label:s("mode_station")},{value:"forecast",label:s("mode_forecast")}]}}}],l=[{name:"type",selector:{select:{mode:"dropdown",options:[{value:"daily",label:s("forecast_type_daily")},{value:"today",label:s("forecast_type_today")},{value:"hourly",label:s("forecast_type_hourly")}]}}}];return e`
    <div class="textfield-container">
      <ha-form
        .data=${{mode:r}}
        .schema=${d}
        .hass=${t.hass}
        .disabled=${!h}
        .computeLabel=${()=>s("mode_label")}
        @value-changed=${e=>{const a=e.detail.value?.mode;a&&a!==r&&t._setMode(a)}}
      ></ha-form>

      <div class="grid2">
        <ha-form
          .data=${{type:n.type||"daily"}}
          .schema=${l}
          .hass=${t.hass}
          .computeLabel=${()=>s("chart_type_label")}
          @value-changed=${e=>{const a=e.detail.value?.type;a&&a!==n.type&&t._valueChanged({target:{value:a}},"forecast.type")}}
        ></ha-form>
        <ha-form
          .data=${{title:o.title||""}}
          .schema=${[{name:"title",selector:{text:{}}}]}
          .hass=${t.hass}
          .computeLabel=${()=>s("title")}
          @value-changed=${t._chartTopChanged}
        ></ha-form>
      </div>

      ${c?e`
        <ha-form
          .data=${{weather_entity:o.weather_entity||""}}
          .schema=${i}
          .hass=${t.hass}
          .computeLabel=${()=>s("weather_entity")}
          @value-changed=${e=>{const a=e.detail.value?.weather_entity??"";t._valueChanged({target:{value:a}},"weather_entity")}}
        ></ha-form>
      `:""}
    </div>
  `}(this,S)}
        ${function(t,a){const{t:s,sensorsConfig:o,pastDataAvailable:i,showsStation:h}=a;if(!h&&i)return e``;const d=t._pastSource,l=[{name:"past_source",selector:{select:{mode:"dropdown",options:[{value:"station",label:s("past_source_station")},{value:"openmeteo",label:s("past_source_openmeteo")}]}}}],_=Object.values(o).filter(e=>"string"==typeof e&&""!==e.trim()).length,p="openmeteo"===d?s("summary_openmeteo"):_>0?s("summary_connected").replace("{n}",String(_)):s("summary_no_sensors"),u=e`
    ${i?"":e`
      <div class="hint">${s("openmeteo_history_unavailable")}</div>
    `}

    <div class="textfield-container">
      <ha-form
        .data=${{past_source:d}}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${()=>s("past_source_label")}
        @value-changed=${e=>{const a=e.detail.value?.past_source;a&&a!==d&&t._setPastSource(a)}}
      ></ha-form>

      ${"openmeteo"===d?e`
        <div class="hint">${s("openmeteo_history_hint")}</div>
      `:e`
        <ha-form
          .data=${o}
          .schema=${m=t.hass,[{name:"",type:"grid",schema:c(m).map(e=>({name:e.key,required:r.has(e.key),selector:{entity:e.candidates.length>0?{include_entities:e.candidates}:{domain:"sensor"}}}))}]}
          .hass=${t.hass}
          .computeLabel=${e=>{const t=s(e.name);return e.required?`${t} (${s("required_marker")})`:t}}
          @value-changed=${t._sensorsChanged}
        ></ha-form>
      `}
    </div>
  `;var m;return n({editor:t,sectionKey:"sensors",icon:"mdi:thermometer",title:s("station_sensors_heading"),summary:p,resetLabel:s("reset_section"),body:u})}(this,S)}
        ${function(t,a){const{t:s,cfg:o,fcfg:i,showsStation:r,showsForecast:c}=a,l=[{name:"",type:"grid",schema:[...r?[{name:"days",selector:{number:{min:1,max:14,mode:"box"}}}]:[],...c?[{name:"forecast_days",selector:{number:{min:1,max:14,mode:"box"}}}]:[]]}],_=[{name:"chart_rows",selector:{select:{mode:"dropdown",multiple:!0,options:h.map(({path:e,labelKey:t})=>({value:d(e),label:s(t)}))}}}],p=[{name:"style",selector:{select:{mode:"dropdown",options:[{value:"style2",label:s("chart_style_without_boxes")},{value:"style1",label:s("chart_style_with_boxes")}]}}},{name:"round_temp",selector:{boolean:{}}},{name:"disable_animation",selector:{boolean:{}}}],u={days:s("days"),forecast_days:s("forecast_days"),number_of_forecasts:s("number_of_forecasts"),chart_height:s("chart_height"),chart_rows:s("chart_rows_heading"),style:s("chart_style"),round_temp:s("round_temp"),disable_animation:s("disable_animation")},m=e=>u[e.name]||s(e.name),f=function(e){return h.filter(({path:t,def:a})=>{const s=e[d(t)];return a?!1!==s:!0===s}).map(({path:e})=>d(e))}(i),g=[...r?[String(o.days??7)]:[],...c?[String(o.forecast_days??7)]:[]].join("+"),y=i.number_of_forecasts??8,b=`${g} ${s("summary_days")} · ${y} ${s("summary_columns")} · ${f.length} ${s("summary_rows")}`,v=e`
    <h4 class="subsection">${s("chart_time_range_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{days:o.days,forecast_days:o.forecast_days}}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${m}
        @value-changed=${t._chartTopChanged}
      ></ha-form>
      <ha-form
        .data=${{number_of_forecasts:i.number_of_forecasts,chart_height:i.chart_height}}
        .schema=${[{name:"",type:"grid",schema:[{name:"number_of_forecasts",selector:{number:{min:0,mode:"box"}}},{name:"chart_height",selector:{number:{min:80,max:600,mode:"box"}}}]}]}
        .hass=${t.hass}
        .computeLabel=${m}
        @value-changed=${t._chartForecastChanged}
      ></ha-form>
      <p class="hint">${s("number_of_forecasts_helper")}</p>
    </div>

    <h4 class="subsection">${s("chart_rows_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{chart_rows:f}}
        .schema=${_}
        .hass=${t.hass}
        .computeLabel=${m}
        @value-changed=${e=>{t._applyTogglePaths(h,e.detail.value?.chart_rows??[])}}
      ></ha-form>
      ${!0===i.show_sunshine?e`
        <div class="hint">${s("show_chart_sunshine_hint")}</div>
        <div>${t._renderSunshineAvailabilityHint(o,s)}</div>
      `:""}
    </div>

    <h4 class="subsection">${s("chart_appearance_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{style:i.style||"style2",round_temp:!0===i.round_temp,disable_animation:!0===i.disable_animation}}
        .schema=${p}
        .hass=${t.hass}
        .computeLabel=${m}
        @value-changed=${t._chartForecastChanged}
      ></ha-form>
    </div>

    <!-- Remaining chart sizes (labels_font_size, precip_bar_size) and
         colour overrides (temperature1/2_color, precipitation_color,
         sunshine_color, chart_text_color, chart_datetime_color) live
         in DEFAULTS + YAML only — colours are theme-aware out of the
         box and the editor surface stays cleaner without them. -->
  `;return n({editor:t,sectionKey:"chart",icon:"mdi:chart-line",title:s("chart_section_heading"),summary:b,resetLabel:s("reset_section"),body:v})}(this,S)}
        ${function(t,a){const{t:s,cfg:o,hasSensor:i,hasLiveValue:r}=a,c=!0===o.show_main,h=!0===o.show_attributes,d=e=>[{name:e,selector:{boolean:{}}}],m=[{name:"main_elements",selector:{select:{mode:"dropdown",multiple:!0,options:l.map(({path:e})=>({value:e,label:s(e)}))}}}],f=[{name:"clock_mode",selector:{select:{mode:"dropdown",options:p.map(e=>({value:e,label:s(`clock_${e}`)}))}}}],g=function(e,t){return _.filter(({gate:a,gateKey:s})=>{if(!a||!s)return!0;const o="live"===a?e:t;return("string"==typeof s?[s]:s).some(o)})}(r,i),y=[{name:"attributes",selector:{select:{mode:"dropdown",multiple:!0,options:g.map(({path:e})=>({value:e,label:s(e)}))}}}],b=e=>({show_main:s("show_main"),show_attributes:s("show_attributes"),main_elements:s("main_elements_label"),clock_mode:s("clock_label"),attributes:s("attributes_heading")}[e.name]||s(e.name)),v=u(o,g),w=`${s("main_panel_heading")} ${s(c?"summary_on":"summary_off")} · `+(h?`${v.length} ${s("summary_attributes")}`:`${s("attributes_heading")} ${s("summary_off")}`),$=e`
    <div class="textfield-container">
      <ha-form
        .data=${{show_main:c}}
        .schema=${d("show_main")}
        .hass=${t.hass}
        .computeLabel=${b}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
      ${c?e`
        <div class="gated">
          <ha-form
            .data=${{main_elements:u(o,l)}}
            .schema=${m}
            .hass=${t.hass}
            .computeLabel=${b}
            @value-changed=${e=>{t._applyTogglePaths(l,e.detail.value?.main_elements??[])}}
          ></ha-form>
          <ha-form
            .data=${{clock_mode:t._clockMode}}
            .schema=${f}
            .hass=${t.hass}
            .computeLabel=${b}
            @value-changed=${e=>{const a=e.detail.value?.clock_mode;a&&a!==t._clockMode&&t._setClockMode(a)}}
          ></ha-form>
        </div>
      `:""}

      <div class="divider"></div>

      <ha-form
        .data=${{show_attributes:h}}
        .schema=${d("show_attributes")}
        .hass=${t.hass}
        .computeLabel=${b}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
      ${h?e`
        <div class="gated">
          <ha-form
            .data=${{attributes:v}}
            .schema=${y}
            .hass=${t.hass}
            .computeLabel=${b}
            @value-changed=${e=>{t._applyTogglePaths(g,e.detail.value?.attributes??[])}}
          ></ha-form>
        </div>
      `:""}
    </div>
  `;return n({editor:t,sectionKey:"live_panel",icon:"mdi:clock-outline",title:s("live_panel_heading"),summary:w,resetLabel:s("reset_section"),body:$})}(this,S)}
        ${function(t,a){const{t:s,unitsConfig:o}=a,i=[o.pressure||"hPa",o.speed||"km/h",o.precipitation||"mm"].join(" · "),r=e`
    <div class="textfield-container">
      <ha-form
        .data=${o}
        .schema=${m}
        .hass=${t.hass}
        .computeLabel=${e=>({pressure:s("unit_pressure_label"),speed:s("unit_speed_label"),precipitation:s("unit_precipitation_label")}[e.name]||e.name)}
        @value-changed=${t._unitsChanged}
      ></ha-form>
    </div>
  `;return n({editor:t,sectionKey:"units",icon:"mdi:ruler",title:s("units_heading"),summary:i,resetLabel:s("reset_section"),body:r})}(this,S)}
        ${function(t,a){const{t:s,cfg:o}=a,i=o.tap_action?.action||"none",r=`${s("tap_action_label")}: ${i}`,c=e`
    <div class="textfield-container">
      ${[["tap_action","tap_action_label"],["hold_action","hold_action_label"],["double_tap_action","double_tap_action_label"]].map(([a,i])=>e`
        <ha-selector
          .hass=${t.hass}
          .selector=${{ui_action:{}}}
          .value=${o[a]}
          .label=${s(i)}
          @value-changed=${e=>t._actionChanged(a,e.detail.value)}
        ></ha-selector>
      `)}
    </div>
  `;return n({editor:t,sectionKey:"actions",icon:"mdi:gesture-tap",title:s("actions_section_heading"),summary:r,resetLabel:s("reset_section"),body:c})}(this,S)}
        <div class="editor-footer">
          <a href="https://github.com/chriguschneider/weather-station-card/blob/master/docs/CONFIGURATION.md"
             target="_blank" rel="noopener noreferrer">
            📖 ${t("open_documentation")}
          </a>
        </div>
      </div>
    `}});
