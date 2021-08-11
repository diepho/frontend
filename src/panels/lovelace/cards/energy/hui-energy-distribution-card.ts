import {
  mdiArrowDown,
  mdiArrowLeft,
  mdiArrowRight,
  mdiArrowUp,
  mdiBatteryHigh,
  mdiHome,
  mdiLeaf,
  mdiSolarPower,
  mdiTransmissionTower,
} from "@mdi/js";
import { UnsubscribeFunc } from "home-assistant-js-websocket";
import { css, html, LitElement, svg } from "lit";
import { customElement, property, state } from "lit/decorators";
import { classMap } from "lit/directives/class-map";
import "@material/mwc-button";
import { formatNumber } from "../../../../common/string/format_number";
import "../../../../components/ha-card";
import "../../../../components/ha-svg-icon";
import {
  EnergyData,
  energySourcesByType,
  getEnergyDataCollection,
} from "../../../../data/energy";
import {
  calculateStatisticsSumGrowth,
  calculateStatisticsSumGrowthWithPercentage,
} from "../../../../data/history";
import { SubscribeMixin } from "../../../../mixins/subscribe-mixin";
import { HomeAssistant } from "../../../../types";
import { LovelaceCard } from "../../types";
import { EnergyDistributionCardConfig } from "../types";

const CIRCLE_CIRCUMFERENCE = 238.76104;

@customElement("hui-energy-distribution-card")
class HuiEnergyDistrubutionCard
  extends SubscribeMixin(LitElement)
  implements LovelaceCard
{
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _config?: EnergyDistributionCardConfig;

  @state() private _data?: EnergyData;

  public setConfig(config: EnergyDistributionCardConfig): void {
    this._config = config;
  }

  public hassSubscribe(): UnsubscribeFunc[] {
    return [
      getEnergyDataCollection(this.hass, {
        key: this._config?.collection_key,
      }).subscribe((data) => {
        this._data = data;
      }),
    ];
  }

  public getCardSize(): Promise<number> | number {
    return 3;
  }

  protected render() {
    if (!this._config) {
      return html``;
    }

    if (!this._data) {
      return html`Loading…`;
    }

    const prefs = this._data.prefs;
    const types = energySourcesByType(prefs);

    // The strategy only includes this card if we have a grid.
    const hasConsumption = true;

    const hasSolarProduction = types.solar !== undefined;
    const hasBattery = types.battery !== undefined;
    const hasReturnToGrid = hasConsumption && types.grid![0].flow_to.length > 0;

    const totalFromGrid =
      calculateStatisticsSumGrowth(
        this._data.stats,
        types.grid![0].flow_from.map((flow) => flow.stat_energy_from)
      ) ?? 0;

    let totalSolarProduction: number | null = null;

    if (hasSolarProduction) {
      totalSolarProduction =
        calculateStatisticsSumGrowth(
          this._data.stats,
          types.solar!.map((source) => source.stat_energy_from)
        ) || 0;
    }

    let totalBatteryIn: number | null = null;
    let totalBatteryOut: number | null = null;

    if (hasBattery) {
      totalBatteryIn =
        calculateStatisticsSumGrowth(
          this._data.stats,
          types.battery!.map((source) => source.stat_energy_to)
        ) || 0;
      totalBatteryOut =
        calculateStatisticsSumGrowth(
          this._data.stats,
          types.battery!.map((source) => source.stat_energy_from)
        ) || 0;
    }

    let returnedToGrid: number | null = null;

    if (hasReturnToGrid) {
      returnedToGrid =
        calculateStatisticsSumGrowth(
          this._data.stats,
          types.grid![0].flow_to.map((flow) => flow.stat_energy_to)
        ) || 0;
    }

    let solarConsumption: number | null = null;
    if (hasSolarProduction) {
      solarConsumption =
        (totalSolarProduction || 0) -
        (returnedToGrid || 0) -
        (totalBatteryIn || 0);
    }

    let batteryFromGrid: null | number = null;
    let batteryToGrid: null | number = null;
    if (solarConsumption !== null && solarConsumption < 0) {
      // What we returned to the grid and what went in to the battery is more than produced, so we have also used grid energy to fill the battery
      if (hasBattery) {
        batteryFromGrid = solarConsumption * -1;
      }
      solarConsumption = 0;
    }
    let solarToBattery: null | number = null;
    if (hasSolarProduction && hasBattery) {
      batteryToGrid = Math.max(
        0,
        (returnedToGrid || 0) - (totalSolarProduction || 0)
      );
      solarToBattery = totalBatteryIn! - (batteryFromGrid || 0);
    } else if (!hasSolarProduction && hasBattery) {
      batteryToGrid = returnedToGrid;
    }

    let batteryConsumption: number | null = null;
    if (hasBattery) {
      batteryConsumption = (totalBatteryOut || 0) - (batteryToGrid || 0);
    }

    const gridConsumption = Math.max(0, totalFromGrid - (batteryFromGrid || 0));

    const totalHomeConsumption = Math.max(
      0,
      gridConsumption + (solarConsumption || 0) + (batteryConsumption || 0)
    );

    let homeSolarCircumference: number | undefined;
    if (hasSolarProduction) {
      homeSolarCircumference =
        CIRCLE_CIRCUMFERENCE * (solarConsumption! / totalHomeConsumption);
    }

    let homeBatteryCircumference: number | undefined;
    if (batteryConsumption) {
      homeBatteryCircumference =
        CIRCLE_CIRCUMFERENCE * (batteryConsumption / totalHomeConsumption);
    }

    let lowCarbonEnergy: number | undefined;

    let homeLowCarbonCircumference: number | undefined;
    let homeHighCarbonCircumference: number | undefined;

    // This fallback is used in the demo
    let electricityMapUrl = "https://www.electricitymap.org";

    if (
      this._data.co2SignalEntity &&
      this._data.co2SignalEntity in this._data.stats
    ) {
      // Calculate high carbon consumption
      const highCarbonEnergy = calculateStatisticsSumGrowthWithPercentage(
        this._data.stats[this._data.co2SignalEntity],
        types
          .grid![0].flow_from.map(
            (flow) => this._data!.stats[flow.stat_energy_from]
          )
          .filter(Boolean)
      );

      const co2State = this.hass.states[this._data.co2SignalEntity];

      if (co2State?.attributes.country_code) {
        electricityMapUrl += `/zone/${co2State.attributes.country_code}`;
      }

      if (highCarbonEnergy !== null) {
        lowCarbonEnergy = totalFromGrid - highCarbonEnergy;

        let highCarbonConsumption: number;
        if (gridConsumption !== totalFromGrid) {
          // Only get the part that was used for consumption and not the battery
          highCarbonConsumption =
            highCarbonEnergy * (gridConsumption / totalFromGrid);
        } else {
          highCarbonConsumption = highCarbonEnergy;
        }

        homeHighCarbonCircumference =
          CIRCLE_CIRCUMFERENCE * (highCarbonConsumption / totalHomeConsumption);

        homeLowCarbonCircumference =
          CIRCLE_CIRCUMFERENCE -
          (homeSolarCircumference || 0) -
          (homeBatteryCircumference || 0) -
          homeHighCarbonCircumference;
      }
    }

    const totalOutput =
      totalFromGrid + (totalSolarProduction || 0) + (totalBatteryOut || 0);

    return html`
      <ha-card .header=${this._config.title}>
        <div class="card-content">
          ${lowCarbonEnergy !== undefined || hasSolarProduction
            ? html`<div class="row">
                ${lowCarbonEnergy === undefined
                  ? html`<div class="spacer"></div>`
                  : html`<div class="circle-container low-carbon">
                      <span class="label">Non-fossil</span>
                      <a
                        class="circle"
                        href=${electricityMapUrl}
                        target="_blank"
                        rel="noopener no referrer"
                      >
                        <ha-svg-icon .path="${mdiLeaf}"></ha-svg-icon>
                        ${lowCarbonEnergy
                          ? formatNumber(lowCarbonEnergy, this.hass.locale, {
                              maximumFractionDigits: 1,
                            })
                          : "-"}
                        kWh
                      </a>
                      <svg width="80" height="30">
                        <line x1="40" y1="0" x2="40" y2="30"></line>
                      </svg>
                    </div>`}
                ${hasSolarProduction
                  ? html`<div class="circle-container solar">
                      <span class="label">Solar</span>
                      <div class="circle">
                        <ha-svg-icon .path="${mdiSolarPower}"></ha-svg-icon>
                        ${formatNumber(
                          totalSolarProduction || 0,
                          this.hass.locale,
                          { maximumFractionDigits: 1 }
                        )}
                        kWh
                      </div>
                    </div>`
                  : ""}
                <div class="spacer"></div>
              </div>`
            : ""}
          <div class="row">
            <div class="circle-container grid">
              <div class="circle">
                <ha-svg-icon .path="${mdiTransmissionTower}"></ha-svg-icon>
                ${returnedToGrid !== null
                  ? html`<span class="return">
                      <ha-svg-icon
                        class="small"
                        .path=${mdiArrowLeft}
                      ></ha-svg-icon
                      >${formatNumber(returnedToGrid, this.hass.locale, {
                        maximumFractionDigits: 1,
                      })}
                      kWh
                    </span>`
                  : ""}
                <span class="consumption">
                  ${hasReturnToGrid
                    ? html`<ha-svg-icon
                        class="small"
                        .path=${mdiArrowRight}
                      ></ha-svg-icon>`
                    : ""}${formatNumber(totalFromGrid, this.hass.locale, {
                    maximumFractionDigits: 1,
                  })}
                  kWh
                </span>
              </div>
              <span class="label">Grid</span>
            </div>
            <div class="circle-container home">
              <div
                class="circle ${classMap({
                  border:
                    homeSolarCircumference === undefined &&
                    homeLowCarbonCircumference === undefined,
                })}"
              >
                <ha-svg-icon .path="${mdiHome}"></ha-svg-icon>
                ${formatNumber(totalHomeConsumption, this.hass.locale, {
                  maximumFractionDigits: 1,
                })}
                kWh
                ${homeSolarCircumference !== undefined ||
                homeLowCarbonCircumference !== undefined
                  ? html`<svg>
                      ${homeSolarCircumference !== undefined
                        ? svg`<circle
                            class="solar"
                            cx="40"
                            cy="40"
                            r="38"
                            stroke-dasharray="${homeSolarCircumference} ${
                            CIRCLE_CIRCUMFERENCE - homeSolarCircumference
                          }"
                            shape-rendering="geometricPrecision"
                            stroke-dashoffset="-${
                              CIRCLE_CIRCUMFERENCE - homeSolarCircumference
                            }"
                          />`
                        : ""}
                      ${homeBatteryCircumference
                        ? svg`<circle
                            class="battery"
                            cx="40"
                            cy="40"
                            r="38"
                            stroke-dasharray="${homeBatteryCircumference} ${
                            CIRCLE_CIRCUMFERENCE - homeBatteryCircumference
                          }"
                            stroke-dashoffset="-${
                              CIRCLE_CIRCUMFERENCE -
                              homeBatteryCircumference -
                              (homeSolarCircumference || 0)
                            }"
                            shape-rendering="geometricPrecision"
                          />`
                        : ""}
                      ${homeLowCarbonCircumference
                        ? svg`<circle
                            class="low-carbon"
                            cx="40"
                            cy="40"
                            r="38"
                            stroke-dasharray="${homeLowCarbonCircumference} ${
                            CIRCLE_CIRCUMFERENCE - homeLowCarbonCircumference
                          }"
                            stroke-dashoffset="-${
                              CIRCLE_CIRCUMFERENCE -
                              homeLowCarbonCircumference -
                              (homeBatteryCircumference || 0) -
                              (homeSolarCircumference || 0)
                            }"
                            shape-rendering="geometricPrecision"
                          />`
                        : ""}
                      <circle
                        class="grid"
                        cx="40"
                        cy="40"
                        r="38"
                        stroke-dasharray="${homeHighCarbonCircumference ??
                        CIRCLE_CIRCUMFERENCE -
                          homeSolarCircumference! -
                          (homeBatteryCircumference ||
                            0)} ${homeHighCarbonCircumference !== undefined
                          ? CIRCLE_CIRCUMFERENCE - homeHighCarbonCircumference
                          : homeSolarCircumference! +
                            (homeBatteryCircumference || 0)}"
                        stroke-dashoffset="0"
                        shape-rendering="geometricPrecision"
                      />
                    </svg>`
                  : ""}
              </div>
              <span class="label">Home</span>
            </div>
          </div>
          ${hasBattery
            ? html`<div class="row">
                <div class="spacer"></div>
                <div class="circle-container battery">
                  <div class="circle">
                    <ha-svg-icon .path="${mdiBatteryHigh}"></ha-svg-icon>
                    <span class="battery-in">
                      <ha-svg-icon
                        class="small"
                        .path=${mdiArrowDown}
                      ></ha-svg-icon
                      >${formatNumber(totalBatteryIn || 0, this.hass.locale, {
                        maximumFractionDigits: 1,
                      })}
                      kWh</span
                    >
                    <span class="battery-out">
                      <ha-svg-icon
                        class="small"
                        .path=${mdiArrowUp}
                      ></ha-svg-icon>
                      ${formatNumber(totalBatteryOut || 0, this.hass.locale, {
                        maximumFractionDigits: 1,
                      })}
                      kWh</span
                    >
                  </div>
                  <span class="label">Battery</span>
                </div>
                <div class="spacer"></div>
              </div>`
            : ""}
          <div class="lines ${classMap({ battery: hasBattery })}">
            <svg
              viewBox="0 0 100 100"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="xMidYMid slice"
            >
              ${hasReturnToGrid && hasSolarProduction
                ? svg`<path
                    id="return"
                    class="return"
                    d="M${hasBattery ? 45 : 47},0 v15 c0,${
                    hasBattery ? "35 -10,30 -30,30" : "40 -10,35 -30,35"
                  } h-20"
                    vector-effect="non-scaling-stroke"
                  ></path> `
                : ""}
              ${hasSolarProduction
                ? svg`<path
                    id="solar"
                    class="solar"
                    d="M${hasBattery ? 55 : 53},0 v15 c0,${
                    hasBattery ? "35 10,30 30,30" : "40 10,35 30,35"
                  } h20"
                    vector-effect="non-scaling-stroke"
                  ></path>`
                : ""}
              ${hasBattery
                ? svg`<path
                    id="battery-house"
                    class="battery-house"
                    d="M55,100 v-15 c0,-35 10,-30 30,-30 h20"
                    vector-effect="non-scaling-stroke"
                  ></path>
                  <path
                    id="battery-grid"
                    class=${classMap({
                      "battery-from-grid": Boolean(batteryFromGrid),
                      "battery-to-grid": Boolean(batteryToGrid),
                    })}
                    d="M45,100 v-15 c0,-35 -10,-30 -30,-30 h-20"
                    vector-effect="non-scaling-stroke"
                  ></path>
                  `
                : ""}
              ${hasBattery && hasSolarProduction
                ? svg`<path
                    id="battery-solar"
                    class="battery-solar"
                    d="M50,0 V100"
                    vector-effect="non-scaling-stroke"
                  ></path>`
                : ""}
              <path
                class="grid"
                id="grid"
                d="M0,${hasBattery ? 50 : hasSolarProduction ? 56 : 53} H100"
                vector-effect="non-scaling-stroke"
              ></path>
              ${returnedToGrid && hasSolarProduction
                ? svg`<circle
                    r="1"
                    class="return"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${6 - (returnedToGrid / totalOutput) * 5}s"
                      repeatCount="indefinite"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#return" />
                    </animateMotion>
                  </circle>`
                : ""}
              ${solarConsumption
                ? svg`<circle
                    r="1"
                    class="solar"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${6 - (solarConsumption / totalOutput) * 5}s"
                      repeatCount="indefinite"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#solar" />
                    </animateMotion>
                  </circle>`
                : ""}
              ${gridConsumption
                ? svg`<circle
                    r="1"
                    class="grid"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${6 - (gridConsumption / totalOutput) * 5}s"
                      repeatCount="indefinite"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#grid" />
                    </animateMotion>
                  </circle>`
                : ""}
              ${solarToBattery
                ? svg`<circle
                    r="1"
                    class="battery-solar"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${6 - (solarToBattery / totalOutput) * 5}s"
                      repeatCount="indefinite"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#battery-solar" />
                    </animateMotion>
                  </circle>`
                : ""}
              ${batteryConsumption
                ? svg`<circle
                    r="1"
                    class="battery-house"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${6 - (batteryConsumption / totalOutput) * 5}s"
                      repeatCount="indefinite"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#battery-house" />
                    </animateMotion>
                  </circle>`
                : ""}
              ${batteryFromGrid
                ? svg`<circle
                    r="1"
                    class="battery-from-grid"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${6 - (batteryFromGrid / totalOutput) * 5}s"
                      repeatCount="indefinite"
                      keyPoints="1;0" keyTimes="0;1"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#battery-grid" />
                    </animateMotion>
                  </circle>`
                : ""}
              ${batteryToGrid
                ? svg`<circle
                    r="1"
                    class="battery-to-grid"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${6 - (batteryToGrid / totalOutput) * 5}s"
                      repeatCount="indefinite"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#battery-grid" />
                    </animateMotion>
                  </circle>`
                : ""}
            </svg>
          </div>
        </div>
        ${this._config.link_dashboard
          ? html`
              <div class="card-actions">
                <a href="/energy"
                  ><mwc-button> Go to the energy dashboard </mwc-button></a
                >
              </div>
            `
          : ""}
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      --mdc-icon-size: 24px;
    }
    .card-content {
      position: relative;
    }
    .lines {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 146px;
      display: flex;
      justify-content: center;
      padding: 0 16px 16px;
      box-sizing: border-box;
    }
    .lines.battery {
      bottom: 100px;
      height: 156px;
    }
    .lines svg {
      width: calc(100% - 160px);
      height: 100%;
      max-width: 340px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      max-width: 500px;
      margin: 0 auto;
    }
    .circle-container {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .circle-container.low-carbon {
      margin-right: 4px;
    }
    .circle-container.solar {
      margin-left: 4px;
      height: 130px;
    }
    .circle-container.battery {
      height: 110px;
      justify-content: flex-end;
    }
    .spacer {
      width: 84px;
    }
    .circle {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      box-sizing: border-box;
      border: 2px solid;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 12px;
      line-height: 12px;
      position: relative;
      text-decoration: none;
      color: var(--primary-text-color);
    }
    ha-svg-icon {
      padding-bottom: 2px;
    }
    ha-svg-icon.small {
      --mdc-icon-size: 12px;
    }
    .label {
      color: var(--secondary-text-color);
      font-size: 12px;
    }
    line,
    path {
      stroke: var(--primary-text-color);
      stroke-width: 1;
      fill: none;
    }
    .circle svg {
      position: absolute;
      fill: none;
      stroke-width: 4px;
      width: 100%;
      height: 100%;
    }
    .low-carbon line {
      stroke: var(--energy-non-fossil-color);
    }
    .low-carbon .circle {
      border-color: var(--energy-non-fossil-color);
    }
    .low-carbon ha-svg-icon {
      color: var(--energy-non-fossil-color);
    }
    circle.low-carbon {
      stroke: var(--energy-non-fossil-color);
      fill: var(--energy-non-fossil-color);
    }
    .solar .circle {
      border-color: var(--energy-solar-color);
    }
    circle.solar,
    path.solar {
      stroke: var(--energy-solar-color);
    }
    circle.solar {
      stroke-width: 4;
      fill: var(--energy-solar-color);
    }
    .battery .circle {
      border-color: var(--energy-battery-in-color);
    }
    circle.battery,
    path.battery {
      stroke: var(--energy-battery-out-color);
    }
    path.battery-house,
    circle.battery-house {
      stroke: var(--energy-battery-out-color);
    }
    circle.battery-house {
      stroke-width: 4;
      fill: var(--energy-battery-out-color);
    }
    path.battery-solar,
    circle.battery-solar {
      stroke: var(--energy-battery-in-color);
    }
    circle.battery-solar {
      stroke-width: 4;
      fill: var(--energy-battery-in-color);
    }
    .battery-in {
      color: var(--energy-battery-in-color);
    }
    .battery-out {
      color: var(--energy-battery-out-color);
    }
    path.battery-from-grid {
      stroke: var(--energy-grid-consumption-color);
    }
    path.battery-to-grid {
      stroke: var(--energy-grid-return-color);
    }
    path.return,
    circle.return,
    circle.battery-to-grid {
      stroke: var(--energy-grid-return-color);
    }
    circle.return {
      stroke-width: 4;
      fill: var(--energy-grid-return-color);
    }
    .return {
      color: var(--energy-grid-return-color);
    }
    .grid .circle {
      border-color: var(--energy-grid-consumption-color);
    }
    .consumption {
      color: var(--energy-grid-consumption-color);
    }
    circle.grid,
    circle.battery-from-grid,
    path.grid {
      stroke: var(--energy-grid-consumption-color);
    }
    circle.grid,
    circle.battery-from-grid {
      stroke-width: 4;
      fill: var(--energy-grid-consumption-color);
    }
    .home .circle {
      border-width: 0;
      border-color: var(--primary-color);
    }
    .home .circle.border {
      border-width: 2px;
    }
    .circle svg circle {
      animation: rotate-in 0.6s ease-in;
      transition: stroke-dashoffset 0.4s, stroke-dasharray 0.4s;
      fill: none;
    }
    @keyframes rotate-in {
      from {
        stroke-dashoffset: 238.76104;
        stroke-dasharray: 238.76104;
      }
    }
    .card-actions a {
      text-decoration: none;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-energy-distribution-card": HuiEnergyDistrubutionCard;
  }
}
