import { useState } from "react";
import { api, errText } from "../lib/api";
import { toast } from "../lib/store";
import type { CatalogEntry, ModelCard } from "../lib/types";
import { Button, Field, Modal } from "./ui";

export function ModelEditModal({
  card,
  onClose,
  onSaved,
}: {
  card: ModelCard;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(card.name);
  const [vendor, setVendor] = useState(card.vendor);
  const [summary, setSummary] = useState(card.summary);
  const [context, setContext] = useState(card.context ? String(card.context) : "");
  const [maxOutput, setMaxOutput] = useState(card.maxOutput ? String(card.maxOutput) : "");
  const [currency, setCurrency] = useState(card.price?.currency ?? "CNY");
  const [unit, setUnit] = useState(card.price?.unit ?? "每 1M tokens");
  const [input, setInput] = useState(
    card.price?.input !== null && card.price?.input !== undefined ? String(card.price.input) : "",
  );
  const [output, setOutput] = useState(
    card.price?.output !== null && card.price?.output !== undefined
      ? String(card.price.output)
      : "",
  );
  const [priceNote, setPriceNote] = useState(card.price?.note ?? "");
  const [abilities, setAbilities] = useState(card.abilities.join("、"));
  const [source, setSource] = useState(card.source ?? "");
  const [verified, setVerified] = useState(card.verified);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const entry: CatalogEntry = {
      match: [card.id],
      name: name.trim() || card.id,
      vendor: vendor.trim(),
      providers: [],
      summary: summary.trim(),
      context: context.trim() === "" ? null : Number(context),
      maxOutput: maxOutput.trim() === "" ? null : Number(maxOutput),
      price: {
        currency: currency.trim(),
        unit: unit.trim(),
        input: input.trim() === "" ? null : Number(input),
        output: output.trim() === "" ? null : Number(output),
        note: priceNote.trim() || null,
      },
      abilities: abilities
        .split(/[、,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      verified,
      verifiedAt: null,
      source: source.trim() || null,
      edited: true,
    };
    try {
      await api.saveCatalogEntry(entry);
      toast("已保存到本地资料库");
      onSaved();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`编辑模型资料 · ${card.id}`}
      onClose={onClose}
      wide
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 14 }}>
        修改只保存在本机（catalog_overrides.json），并在模型库里优先于内置资料生效。
      </div>

      <div className="row-2">
        <Field label="显示名称">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="厂商">
          <input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </Field>
      </div>

      <Field label="一句话简介">
        <textarea
          className="input"
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="例如：旗舰推理模型，1M 上下文，适合复杂长任务"
        />
      </Field>

      <div className="row-2">
        <Field label="上下文长度（tokens）">
          <input
            className="input"
            type="number"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="如 1000000"
          />
        </Field>
        <Field label="最长输出（tokens）">
          <input
            className="input"
            type="number"
            value={maxOutput}
            onChange={(e) => setMaxOutput(e.target.value)}
            placeholder="如 384000"
          />
        </Field>
      </div>

      <div className="row-2">
        <Field label="输入价格">
          <input
            className="input"
            type="number"
            step="0.001"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="留空表示未知"
          />
        </Field>
        <Field label="输出价格">
          <input
            className="input"
            type="number"
            step="0.001"
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="留空表示未知"
          />
        </Field>
      </div>

      <div className="row-2">
        <Field label="币种">
          <select
            className="select"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="CNY">CNY 人民币</option>
            <option value="USD">USD 美元</option>
          </select>
        </Field>
        <Field label="计价单位">
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
      </div>

      <Field label="价格备注">
        <input
          className="input"
          value={priceNote}
          onChange={(e) => setPriceNote(e.target.value)}
          placeholder="如：低峰时段减半；缓存命中输入 $0.006"
        />
      </Field>

      <Field label="能力标签" hint="用「、」或逗号分隔，如：工具调用、视觉、推理、代码">
        <input
          className="input"
          value={abilities}
          onChange={(e) => setAbilities(e.target.value)}
        />
      </Field>

      <Field label="官方来源链接">
        <input
          className="input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="https://…"
          spellCheck={false}
        />
      </Field>

      <label
        className="setting-row"
        style={{ borderBottom: "none", paddingTop: 4, cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
          style={{ width: 15, height: 15 }}
        />
        <div className="txt">
          <b>标记为「已核实」</b>
          <span>勾选表示这条资料已经对照官网核对过，模型库里会显示绿色徽标</span>
        </div>
      </label>
    </Modal>
  );
}
