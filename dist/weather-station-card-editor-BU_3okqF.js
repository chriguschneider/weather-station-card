import{b as e,i as t,r as s,l as o}from"./main-BckQ4I0S.js";function n(t){const{editor:s,title:o,sectionKey:n,resetLabel:i}=t;return e`
    <h3 class="section section-header-with-reset">
      <span class="section-title">${o}</span>
      <ha-icon-button
        class="section-reset"
        title="${i}"
        aria-label="${i}"
        @click=${()=>s._resetSection(n)}
      >
        <ha-icon icon="mdi:restore"></ha-icon>
      </ha-icon-button>
    </h3>
  `}const i=new Set(["temperature"]);const a=[{name:"weather_entity",required:!0,selector:{entity:{domain:"weather"}}}],r=[{name:"number_of_forecasts",selector:{number:{min:0,mode:"box"}}}],c=[{name:"condition_icons",selector:{boolean:{}}},{name:"show_wind_arrow",selector:{boolean:{}}},{name:"show_wind_speed",selector:{boolean:{}}},{name:"show_date",selector:{boolean:{}}},{name:"show_sunshine",selector:{boolean:{}}}],h=[{name:"pressure",selector:{select:{mode:"dropdown",options:["hPa","mmHg","inHg"]}}},{name:"speed",selector:{select:{mode:"dropdown",options:["km/h","m/s","mph","Bft"]}}}],d={pressure:"Convert pressure to",speed:"Convert wind speed to"},l={card_setup:["show_station","show_forecast","forecast.type"],weather_forecast:["weather_entity"],sensors:["sensors"],chart:["title","days","forecast_days","forecast.number_of_forecasts","forecast.condition_icons","forecast.show_wind_arrow","forecast.show_wind_speed","forecast.show_date","forecast.show_sunshine","forecast.style","forecast.round_temp","forecast.disable_animation"],live_panel:["show_main","show_temperature","show_current_condition","show_time","show_time_seconds","use_12hour_format","show_day","show_date","show_attributes","show_humidity","show_pressure","show_dew_point","show_precipitation","show_uv_index","show_illuminance","show_sunshine_duration","show_wind_direction","show_wind_speed","show_wind_gust_speed","show_sun"],units:["units"],actions:["tap_action","hold_action","double_tap_action"]};customElements.define("weather-station-card-editor",class extends t{constructor(){super(...arguments),this.hass=null,this._config=null,this._sensorsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const s=e.detail;this.configChanged({...this._config,sensors:s.value}),this.requestUpdate()},this._sensorPickerChanged=(e,t)=>{if(!this._config)return;const s={...this._config.sensors||{}};""===t||null==t?delete s[e]:s[e]=t,this.configChanged({...this._config,sensors:s}),this.requestUpdate()},this._unitsChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const s=e.detail;this.configChanged({...this._config,units:s.value}),this.requestUpdate()},this._chartTopChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const s=e.detail,o={...this._config};for(const[e,t]of Object.entries(s.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged(o),this.requestUpdate()},this._chartForecastChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const s=e.detail,o={...this._config.forecast||{}};for(const[e,t]of Object.entries(s.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged({...this._config,forecast:o}),this.requestUpdate()},this._livePanelChanged=e=>{if(!this._config)return;const t=e.target;if("ha-form"!==t?.tagName.toLowerCase())return;const s=e.detail,o={...this._config};for(const[e,t]of Object.entries(s.value))void 0===t||""===t?delete o[e]:o[e]=t;this.configChanged(o),this.requestUpdate()},this._resetSection=e=>{if(!this._config)return;const t=l[e];if(!t)return;const s=JSON.parse(JSON.stringify(this._config));for(const e of t)this._deleteByPath(s,e);this.configChanged(s),this.requestUpdate()},this._valueChanged=(e,t)=>{if(!this._config)return;const s={...this._config},o=e.target.checked??e.target.value;if(t.includes(".")){const e=t.split(".");let n=s;for(let t=0;t<e.length-1;t++)n[e[t]]={...n[e[t]]},n=n[e[t]];n[e[e.length-1]]=o}else s[t]=o;this.configChanged(s),this.requestUpdate()},this._actionChanged=(e,t)=>{if(!this._config)return;const s={...this._config};null==t?delete s[e]:s[e]=t,this.configChanged(s),this.requestUpdate()},this._conditionMappingChanged=(e,t)=>{if(!this._config)return;const s=e.target.value,o={...this._config.condition_mapping||{}};if(""===s||null==s)delete o[t];else{const e=parseFloat(s);Number.isFinite(e)&&(o[t]=e)}const n={...this._config};0===Object.keys(o).length?delete n.condition_mapping:n.condition_mapping=o,this.configChanged(n),this.requestUpdate()}}static get properties(){return{_config:{type:Object},hass:{type:Object}}}setConfig(e){if(!e)throw new Error("Invalid configuration");this._config=e,this.requestUpdate()}get config(){return this._config}get _mode(){if(!this._config)return"station";const e=!1!==this._config.show_station,t=!0===this._config.show_forecast;return e&&t?"combination":t?"forecast":"station"}_setMode(e){if(!this._config)return;const t={...this._config};switch(e){case"station":t.show_station=!0,t.show_forecast=!1;break;case"forecast":t.show_station=!1,t.show_forecast=!0;break;case"combination":t.show_station=!0,t.show_forecast=!0}this.configChanged(t),this.requestUpdate()}configChanged(e){const t=new Event("config-changed",{bubbles:!0,composed:!0});t.detail={config:e},this.dispatchEvent(t)}_deleteByPath(e,t){const s=t.split("."),o=[e];let n=e;for(let e=0;e<s.length-1;e++){const t=n?.[s[e]];if(!t||"object"!=typeof t)return;n=t,o.push(n)}delete n[s[s.length-1]];for(let e=o.length-1;e>0;e--){const t=o[e];if(!t||0!==Object.keys(t).length)break;delete o[e-1][s[e-1]]}}_renderSunshineAvailabilityHint(t,o){const n=t&&t.forecast;if(!0!==n?.show_sunshine)return"";const i=this.hass,a=i?.config?i.config.latitude:null,r=i?.config?i.config.longitude:null;if(!Number.isFinite(a)||!Number.isFinite(r))return"";const c=s(a,r);if(!c)return e`<div class="hint" style="margin-top:4px;">
        ${o("sunshine_availability_pending")}
      </div>`;const h=parseInt(String(t.forecast_days??(t.days||7)),10),d=Number.isFinite(h)&&c.forecastDays>0&&h>c.forecastDays,l=(o("sunshine_availability")||"Sunshine: {past} past, {future} forecast days available").replace("{past}",String(c.pastDays)).replace("{future}",String(c.forecastDays));return e`
      <div class="hint" style="margin-top:4px;">
        ${l}
        ${d?e`<br/>${(o("sunshine_availability_warning")||"Configured forecast_days ({req}) exceeds available — last {gap} columns will have empty sunshine bars.").replace("{req}",String(h)).replace("{gap}",String(h-c.forecastDays))}`:""}
      </div>
    `}render(){const t=e=>function(e,t){const s=e?.language||"en",n=s.split("-")[0];for(const e of[s,n,"en"]){const s=o[e]?.editor;if(s&&"string"==typeof s[t])return s[t]}return t}(this.hass,e),s=this._config??{},l=s.forecast??{},_=s.sensors??{},u=s.units??{},m=this._mode,p="combination"===m,f="forecast"===m||p,g="station"===m||p,w={humidity:"humidity",pressure:"pressure",dew_point:"dew_point",uv_index:"uv_index",wind_direction:"wind_bearing",wind_speed:"wind_speed",gust_speed:"wind_gust_speed"},b="string"==typeof s.weather_entity?s.weather_entity:"",y=b?this.hass?.states?.[b]:void 0,v=y?.attributes??{},x={t:t,cfg:s,fcfg:l,sensorsConfig:_,unitsConfig:u,mode:m,showsStation:g,showsForecast:f,hasSensor:e=>!!_[e],hasLiveValue:e=>{if(_[e])return!0;const t=w[e];if(!t)return!1;return null!=v[t]}};return e`
      <style>
        h3.section {
          font-size: 1rem;
          font-weight: 500;
          color: var(--primary-text-color);
          margin: 24px 0 12px;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--divider-color);
        }
        h3.section:first-of-type { margin-top: 0; }
        /* Section headers with the reset-to-defaults icon button.
           The button right-aligns in the heading; clicking it
           drops every key the section owns from this._config so DEFAULTS
           take over. */
        h3.section.section-header-with-reset {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        h3.section.section-header-with-reset .section-title {
          flex: 1;
        }
        h3.section.section-header-with-reset .section-reset {
          --mdc-icon-button-size: 32px;
          --mdc-icon-size: 18px;
          color: var(--secondary-text-color);
          opacity: 0.7;
        }
        h3.section.section-header-with-reset .section-reset:hover {
          opacity: 1;
          color: var(--primary-text-color);
        }
        h4.subsection {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--secondary-text-color);
          margin: 18px 0 8px;
        }
        details.advanced {
          margin-top: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          padding: 8px 12px;
        }
        details.advanced > summary {
          cursor: pointer;
          color: var(--primary-text-color);
          font-weight: 500;
        }
        details.advanced[open] > summary {
          margin-bottom: 12px;
        }
        details.expert-section { margin-top: 24px; }
        details.expert-section > summary {
          cursor: pointer;
          list-style: none;
        }
        details.expert-section > summary::-webkit-details-marker { display: none; }
        details.expert-section > summary > h3.section-summary {
          display: inline-block;
          margin: 0;
          padding-bottom: 4px;
        }
        details.expert-section > summary::before {
          content: '▶';
          display: inline-block;
          width: 1em;
          font-size: 0.85em;
          transition: transform 0.15s;
        }
        details.expert-section[open] > summary::before { transform: rotate(90deg); }
        details.expert-section[open] > summary { margin-bottom: 12px; }
        .switch-label { padding-left: 14px; }
        .switch-container { margin-bottom: 12px; display: flex; align-items: center; }
        .textfield-container {
          display: flex; flex-direction: column; margin-bottom: 10px; gap: 16px;
        }
        .flex-container { display: flex; flex-direction: row; gap: 20px; }
        .flex-container ha-textfield { flex-basis: 50%; flex-grow: 1; }
        .radio-group { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
        .radio-item { display: flex; align-items: center; }
        .radio-item label { margin-left: 4px; }
        .hint {
          font-size: 0.85rem;
          color: var(--secondary-text-color);
          margin: 4px 0 12px;
        }
        .editor-footer {
          margin-top: 24px;
          padding-top: 12px;
          border-top: 1px solid var(--divider-color);
          text-align: right;
        }
        .editor-footer a {
          color: var(--primary-color);
          text-decoration: none;
          font-size: 0.9rem;
        }
        .editor-footer a:hover { text-decoration: underline; }
      </style>

      <div>
        ${function(t,s){const{t:o,fcfg:i,mode:a}=s,r=[{name:"mode",selector:{select:{mode:"dropdown",options:[{value:"combination",label:o("mode_combination")},{value:"station",label:o("mode_station")},{value:"forecast",label:o("mode_forecast")}]}}}],c=[{name:"type",selector:{select:{mode:"dropdown",options:[{value:"daily",label:o("forecast_type_daily")},{value:"today",label:o("forecast_type_today")},{value:"hourly",label:o("forecast_type_hourly")}]}}}];return e`
    ${n({editor:t,title:o("card_setup_heading"),sectionKey:"card_setup",resetLabel:o("reset_section")})}
    <div class="textfield-container">
      <ha-form
        .data=${{mode:a}}
        .schema=${r}
        .hass=${t.hass}
        .computeLabel=${()=>o("mode_label")}
        @value-changed=${e=>{const s=e.detail.value?.mode;s&&s!==a&&t._setMode(s)}}
      ></ha-form>

      <ha-form
        .data=${{type:i.type||"daily"}}
        .schema=${c}
        .hass=${t.hass}
        .computeLabel=${()=>o("chart_type_label")}
        @value-changed=${e=>{const s=e.detail.value?.type;s&&s!==i.type&&t._valueChanged({target:{value:s}},"forecast.type")}}
      ></ha-form>
    </div>
  `}(this,x)}
        ${f?function(t,s){const{t:o,cfg:i}=s;return e`
    ${n({editor:t,title:o("weather_forecast_heading"),sectionKey:"weather_forecast",resetLabel:o("reset_section")})}
    <div class="textfield-container">
      <ha-form
        .data=${{weather_entity:i.weather_entity||""}}
        .schema=${a}
        .hass=${t.hass}
        .computeLabel=${()=>o("weather_entity")}
        @value-changed=${e=>{const s=e.detail.value?.weather_entity??"";t._valueChanged({target:{value:s}},"weather_entity")}}
      ></ha-form>
    </div>
  `}(this,x):""}
        ${g?function(t,s){const{t:o,sensorsConfig:a}=s;return e`
    ${n({editor:t,title:o("station_sensors_heading"),sectionKey:"sensors",resetLabel:o("reset_section")})}
    <div class="textfield-container">
      <ha-form
        .data=${a}
        .schema=${r=t.hass,function(e){const t=e?.states?Object.entries(e.states).filter(([,e])=>!!e):[],s=e=>t.filter(([t,s])=>t.startsWith("sensor.")&&e.includes(s.attributes?.device_class||"")).map(([e])=>e),o=t.filter(([e,t])=>e.startsWith("sensor.")&&("°"===t.attributes?.unit_of_measurement||"deg"===t.attributes?.unit_of_measurement)).map(([e])=>e),n=/(?:^|[._-])uv(?:[._-]|index|$)/i,i=/\buv[\s_-]?index\b|\buv\b/i,a=t.filter(([e,t])=>{if(!e.startsWith("sensor."))return!1;const s=t.attributes?.friendly_name||"";return n.test(e)||i.test(s)}).map(([e])=>e);return[{key:"temperature",candidates:s(["temperature"])},{key:"humidity",candidates:s(["humidity"])},{key:"illuminance",candidates:s(["illuminance"])},{key:"precipitation",candidates:s(["precipitation"])},{key:"pressure",candidates:s(["atmospheric_pressure","pressure"])},{key:"wind_speed",candidates:s(["wind_speed","speed"])},{key:"gust_speed",candidates:s(["wind_speed","speed"])},{key:"wind_direction",candidates:o},{key:"uv_index",candidates:a},{key:"dew_point",candidates:s(["temperature"])},{key:"sunshine_duration",candidates:[]}]}(r).map(e=>({name:e.key,required:i.has(e.key),selector:{entity:e.candidates.length>0?{include_entities:e.candidates}:{domain:"sensor"}}}))}
        .hass=${t.hass}
        .computeLabel=${e=>{const t=o(e.name);return e.required?`${t} (${o("required_marker")})`:t}}
        @value-changed=${t._sensorsChanged}
      ></ha-form>
    </div>
  `;var r}(this,x):""}
        ${function(t,s){const{t:o,cfg:i,fcfg:a,showsStation:h,showsForecast:d}=s,l=function(e,t){const s=[{name:"title",selector:{text:{}}}];return e&&s.push({name:"days",selector:{number:{min:1,max:14,mode:"box"}}}),t&&s.push({name:"forecast_days",selector:{number:{min:1,max:14,mode:"box"}}}),s}(h,d),_=function(e){return[{name:"style",selector:{select:{mode:"dropdown",options:[{value:"style2",label:e("chart_style_without_boxes")},{value:"style1",label:e("chart_style_with_boxes")}]}}},{name:"round_temp",selector:{boolean:{}}},{name:"disable_animation",selector:{boolean:{}}}]}(o),u={title:i.title||"",days:i.days,forecast_days:i.forecast_days},m={number_of_forecasts:a.number_of_forecasts},p={condition_icons:!1!==a.condition_icons,show_wind_arrow:!1!==a.show_wind_arrow,show_wind_speed:!1!==a.show_wind_speed,show_date:!1!==a.show_date,show_sunshine:!0===a.show_sunshine},f={style:a.style||"style2",round_temp:!0===a.round_temp,disable_animation:!0===a.disable_animation},g=e=>o(e.name);return e`
    ${n({editor:t,title:o("chart_section_heading"),sectionKey:"chart",resetLabel:o("reset_section")})}

    <div class="textfield-container">
      <ha-form
        .data=${u}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${e=>"title"===e.name?o("title"):"days"===e.name?o("days"):"forecast_days"===e.name?o("forecast_days"):g(e)}
        @value-changed=${t._chartTopChanged}
      ></ha-form>
    </div>

    <h4 class="subsection">${o("chart_time_range_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${m}
        .schema=${r}
        .hass=${t.hass}
        .computeLabel=${()=>o("number_of_forecasts")}
        @value-changed=${t._chartForecastChanged}
      ></ha-form>
      <p class="hint">${o("number_of_forecasts_hint")}</p>
    </div>

    <h4 class="subsection">${o("chart_rows_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${p}
        .schema=${c}
        .hass=${t.hass}
        .computeLabel=${e=>({condition_icons:o("show_chart_icons"),show_wind_arrow:o("show_chart_wind_direction"),show_wind_speed:o("show_chart_wind_speed"),show_date:o("show_chart_date"),show_sunshine:o("show_chart_sunshine")}[e.name]||g(e))}
        @value-changed=${t._chartForecastChanged}
      ></ha-form>
      ${!0===a.show_sunshine?e`
        <div class="hint" style="padding-left:20px; margin-top:8px;">
          ${o("show_chart_sunshine_hint")}
        </div>
        <div style="padding-left:20px; margin-bottom:8px;">
          ${t._renderSunshineAvailabilityHint(i,o)}
        </div>
      `:""}
    </div>

    <h4 class="subsection">${o("chart_appearance_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${f}
        .schema=${_}
        .hass=${t.hass}
        .computeLabel=${e=>"style"===e.name?o("chart_style"):"round_temp"===e.name?o("round_temp"):"disable_animation"===e.name?o("disable_animation"):g(e)}
        @value-changed=${t._chartForecastChanged}
      ></ha-form>
    </div>

    <!-- Chart sizes (chart_height, labels_font_size, precip_bar_size)
         and colour overrides (temperature1/2_color, precipitation_color,
         sunshine_color, chart_text_color, chart_datetime_color) live in
         DEFAULTS + YAML only — colours are theme-aware out of the box,
         sizes rarely need adjustment, and the editor surface stays
         cleaner without them. -->
  `}(this,x)}
        ${function(t,s){const{t:o,cfg:i,hasSensor:a,hasLiveValue:r}=s,c=!0===i.show_main,h=!0===i.show_time,d=!0===i.show_attributes,l=function(e,t){const s=[{name:"show_main",selector:{boolean:{}}}];return e?(s.push({name:"show_temperature",selector:{boolean:{}}},{name:"show_current_condition",selector:{boolean:{}}},{name:"show_time",selector:{boolean:{}}}),t&&s.push({name:"show_time_seconds",selector:{boolean:{}}},{name:"use_12hour_format",selector:{boolean:{}}}),s.push({name:"show_day",selector:{boolean:{}}},{name:"show_date",selector:{boolean:{}}}),s):s}(c,h),_=function(e,t,s){const o=[{name:"show_attributes",selector:{boolean:{}}}];return e?(t("humidity")&&o.push({name:"show_humidity",selector:{boolean:{}}}),t("pressure")&&o.push({name:"show_pressure",selector:{boolean:{}}}),t("dew_point")&&o.push({name:"show_dew_point",selector:{boolean:{}}}),s("precipitation")&&o.push({name:"show_precipitation",selector:{boolean:{}}}),t("uv_index")&&o.push({name:"show_uv_index",selector:{boolean:{}}}),s("illuminance")&&o.push({name:"show_illuminance",selector:{boolean:{}}}),s("sunshine_duration")&&o.push({name:"show_sunshine_duration",selector:{boolean:{}}}),t("wind_direction")&&o.push({name:"show_wind_direction",selector:{boolean:{}}}),t("wind_speed")&&o.push({name:"show_wind_speed",selector:{boolean:{}}}),t("gust_speed")&&o.push({name:"show_wind_gust_speed",selector:{boolean:{}}}),o.push({name:"show_sun",selector:{boolean:{}}}),o):o}(d,r,a),u={show_main:c,show_temperature:!1!==i.show_temperature,show_current_condition:!1!==i.show_current_condition,show_time:h,show_time_seconds:!0===i.show_time_seconds,use_12hour_format:!0===i.use_12hour_format,show_day:!0===i.show_day,show_date:!0===i.show_date},m={show_attributes:d,show_humidity:!1!==i.show_humidity,show_pressure:!1!==i.show_pressure,show_dew_point:!0===i.show_dew_point,show_precipitation:!0===i.show_precipitation,show_uv_index:!1!==i.show_uv_index,show_illuminance:!0===i.show_illuminance,show_sunshine_duration:!0===i.show_sunshine_duration,show_wind_direction:!1!==i.show_wind_direction,show_wind_speed:!1!==i.show_wind_speed,show_wind_gust_speed:!0===i.show_wind_gust_speed,show_sun:!0===i.show_sun},p=e=>o(e.name);return e`
    ${n({editor:t,title:o("live_panel_heading"),sectionKey:"live_panel",resetLabel:o("reset_section")})}

    <h4 class="subsection">${o("main_panel_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${u}
        .schema=${l}
        .hass=${t.hass}
        .computeLabel=${p}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
    </div>

    <h4 class="subsection">${o("attributes_heading")}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${m}
        .schema=${_}
        .hass=${t.hass}
        .computeLabel=${p}
        @value-changed=${t._livePanelChanged}
      ></ha-form>
    </div>

    <!-- Font-size knobs (current_temp_size, icons_size, time_size,
         day_date_size) live in DEFAULTS + YAML only — most users never
         change them and the editor surface is cleaner without them. -->
  `}(this,x)}
        ${function(t,s){const{t:o,unitsConfig:i}=s;return e`
    <!-- ─── E. Units ────────────────────────────────────────────── -->
    ${n({editor:t,title:o("units_heading"),sectionKey:"units",resetLabel:o("reset_section")})}
    <div class="textfield-container">
      <ha-form
        .data=${i}
        .schema=${h}
        .hass=${t.hass}
        .computeLabel=${e=>d[e.name]||e.name}
        @value-changed=${t._unitsChanged}
      ></ha-form>
    </div>
  `}(this,x)}
        ${function(t,s){const{t:o,cfg:i}=s;return e`
    ${n({editor:t,title:o("actions_section_heading"),sectionKey:"actions",resetLabel:o("reset_section")})}
    <div class="textfield-container">
      ${[["tap_action","tap_action_label"],["hold_action","hold_action_label"],["double_tap_action","double_tap_action_label"]].map(([s,n])=>e`
        <ha-selector
          .hass=${t.hass}
          .selector=${{ui_action:{}}}
          .value=${i[s]}
          .label=${o(n)}
          @value-changed=${e=>t._actionChanged(s,e.detail.value)}
        ></ha-selector>
      `)}
    </div>
  `}(this,x)}
        <div class="editor-footer">
          <a href="https://github.com/chriguschneider/weather-station-card/blob/master/docs/CONFIGURATION.md"
             target="_blank" rel="noopener noreferrer">
            📖 ${t("open_documentation")}
          </a>
        </div>
      </div>
    `}});
