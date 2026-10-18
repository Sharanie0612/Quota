import { activityChannelName, activityFilterLabel, activityModelChannel, activityModelName } from "../lib/activityModels";
import { activityDeviceChoices } from "../lib/activityDevices";
import type { ActivityGroup, ActivityOptions, ActivityReport } from "../lib/types";
import { ModelLogo } from "./ModelLogo";
import { Button } from "./ui";

type DetailProps = { rows: ActivityGroup[]; format: (value: number) => string; onModel: (key: string) => void };
const fullNumber = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

export function ActivityModelDetails({rows, format, onModel}: DetailProps) {
  return rows.length ? <div className="activity-model-table-scroll"><table className="activity-model-table">
    <thead><tr><th>模型</th><th>输入</th><th>缓存命中</th><th>输出</th><th>总 Token</th><th>会话</th></tr></thead>
    <tbody>{[...rows].sort((a,b)=>b.tokens.total-a.tokens.total).map(row=><tr key={row.key}>
      <td><button className="activity-model-link" onClick={()=>onModel(row.key)} aria-label={`按 ${activityFilterLabel(row.key)} 查看用量图表`}><ModelLogo name={activityModelName(row.key)} size={20}/><span>{activityModelName(row.key) || "未知模型"}{activityModelChannel(row.key)&&<small className="activity-model-channel">{activityChannelName(activityModelChannel(row.key))}</small>}</span></button></td>
      {[row.tokens.input,row.tokens.cached,row.tokens.output,row.tokens.total,row.sessions].map((value,index)=><td key={index} title={fullNumber(value)}>{index===4?fullNumber(value):format(value)}</td>)}
    </tr>)}</tbody>
  </table></div> : <p className="hint activity-detail-empty">当前范围暂无模型用量记录。</p>;
}

export function TraeUsageDetails({rows, channels, format, onModel}: DetailProps & { channels: ActivityGroup[] }) {
  const keys = ["trae", "api", ...((channels.some(row=>row.key==="unknown") || rows.some(row=>activityModelChannel(row.key)==="unknown")) ? ["unknown"] : [])];
  return <div className="activity-trae-details">
    <p className="hint">Trae 提供使用 Trae 额度；API 接入使用自行配置的服务商密钥。缓存命中包含在输入中，不重复相加。</p>
    {keys.map(channel=>{
      const total = channels.find(row=>row.key===channel);
      return <section className="card activity-channel-details" aria-label={`${activityChannelName(channel)}模型明细`} key={channel}>
        <div className="activity-channel-heading"><div><h3>{activityChannelName(channel)}</h3><p className="hint">{channel==="trae"?"Trae 额度内的模型用量":channel==="api"?"自带 API 密钥的模型用量":"原始记录缺少通道信息，单独保留"}</p></div><div><strong>{total ? format(total.tokens.total) : "0"}</strong><span> Token · {fullNumber(total?.sessions ?? 0)} 个会话</span></div></div>
        <ActivityModelDetails rows={rows.filter(row=>activityModelChannel(row.key)===channel)} format={format} onModel={onModel}/>
      </section>;
    })}
  </div>;
}

export function ActivityDeviceDetails({rows, devices, options, format, onDevice}: { rows: ActivityGroup[]; devices: ActivityReport["devices"]; options?: ActivityOptions; format: DetailProps["format"]; onDevice: (id: string) => void }) {
  const choices = activityDeviceChoices(devices,options);
  return <section className="card activity-device-details" aria-label="设备用量明细"><h3>设备用量</h3>
    {rows.length ? [...rows].sort((a,b)=>b.tokens.total-a.tokens.total).map(row=>{
      const device = choices.find(item=>item.id===row.key);
      return <article className="activity-device-usage" key={row.key}>
        <div className="activity-device-usage-head"><div><b>{device?.name ?? `远程设备 ${row.key.slice(0,8)}`}</b>{device?.ssh && <span className="activity-channel-tag">SSH 远程</span>}<p className="hint">{device?.aliases.length ? `连接：${device.aliases.join(" / ")}` : device?.known ? "" : "设备名尚未同步"}<span className="activity-device-id" title={row.key}>设备标识：{row.key.slice(0,8)}</span></p></div><Button size="sm" variant="quiet" onClick={()=>onDevice(row.key)}>查看此设备</Button></div>
        <dl>{[{label:"总 Token",value:row.tokens.total},{label:"输入",value:row.tokens.input},{label:"缓存命中",value:row.tokens.cached},{label:"输出",value:row.tokens.output},{label:"会话",value:row.sessions}].map(item=><div key={item.label}><dt>{item.label}</dt><dd title={fullNumber(item.value)}>{item.label==="会话"?fullNumber(item.value):format(item.value)}</dd></div>)}</dl>
      </article>;
    }) : <p className="hint">当前范围暂无设备用量记录。</p>}
  </section>;
}
