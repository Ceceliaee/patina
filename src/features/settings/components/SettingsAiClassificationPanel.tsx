import { Download, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietSelect from "../../../shared/components/QuietSelect.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import {
  listAiClassificationModels,
  loadAiClassificationConfig,
  saveAiClassificationConfig,
} from "../services/aiClassificationSettings.ts";
import SettingsPanelHeader from "./SettingsPanelHeader.tsx";

export default function SettingsAiClassificationPanel() {
  const { settings: text } = useLocaleText();
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [savedUrl, setSavedUrl] = useState("");
  const [busy, setBusy] = useState<"load" | "list" | "save" | null>("load");
  const [status, setStatus] = useState<"error" | "saved" | null>(null);

  useEffect(() => {
    let active = true;
    void loadAiClassificationConfig().then((saved) => {
      if (!active || !saved) return;
      setUrl(saved.url);
      setSavedUrl(saved.url);
      setModel(saved.model);
      setModels([saved.model]);
    }).catch(() => { if (active) setStatus("error"); })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, []);

  const canAuthenticate = Boolean(url.trim() && (apiKey.trim() || url.trim() === savedUrl));
  const clearModels = () => { setModel(""); setModels([]); setStatus(null); };

  async function fetchModels() {
    setBusy("list");
    setStatus(null);
    try {
      const available = await listAiClassificationModels(url, apiKey);
      if (!available.length) { setStatus("error"); return; }
      setModels(available);
      setModel(available.includes(model) ? model : "");
    } catch {
      setStatus("error");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setStatus(null);
    try {
      const config = await saveAiClassificationConfig({ url, model }, apiKey);
      setSavedUrl(config.url);
      setUrl(config.url);
      setApiKey("");
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="qp-panel space-y-3 p-5 md:p-6">
      <SettingsPanelHeader icon={<Sparkles size={16} aria-hidden />} title={text.aiClassification} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="grid min-w-0 gap-1">
          <span>{text.aiApiUrl}</span>
          <input className="qp-input h-[34px] w-full" type="url" value={url} disabled={busy !== null}
            spellCheck={false} onChange={(event) => { setUrl(event.target.value); clearModels(); }} />
        </label>
        <label className="grid min-w-0 gap-1">
          <span>{text.aiApiKey}</span>
          <input className="qp-input h-[34px] w-full" type="password" autoComplete="off" value={apiKey}
            disabled={busy !== null} placeholder={savedUrl && url === savedUrl ? text.saved : undefined}
            onChange={(event) => { setApiKey(event.target.value); clearModels(); }} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <QuietButton onClick={() => void fetchModels()} busy={busy === "list"} disabled={!canAuthenticate || busy !== null}>
          <Download size={14} aria-hidden />{text.aiFetchModels}
        </QuietButton>
        <QuietSelect value={model} ariaLabel={text.aiModel} displayLabel={model || text.aiModel}
          className="min-w-0 max-w-full" disabled={!models.length || busy !== null}
          options={models.map((name) => ({ value: name, label: name }))}
          onChange={(name) => { setModel(name); setStatus(null); }} />
        <QuietButton onClick={() => void save()} busy={busy === "save"} disabled={!model || !canAuthenticate || busy !== null}>
          <Save size={14} aria-hidden />{text.save}
        </QuietButton>
        {status === "error" && <span role="alert">{text.aiConfigFailed}</span>}
        {status === "saved" && <span role="status">{text.saved}</span>}
      </div>
    </section>
  );
}
