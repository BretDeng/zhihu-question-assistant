import { resolveConfig, ZHIDA_MODELS } from "./modelClient.js";

export async function fetchModels(raw, fetchImpl = fetch, signal) {
  if (raw.provider === "zhida") return ZHIDA_MODELS.map(id => ({ id, name: id }));
  const config = resolveConfig(raw);
  const response = await fetchImpl(`${config.baseURL}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` }, credentials: "omit", redirect: "error", signal });
  if (!response.ok) throw new Error(({401:"密钥无效，请检查 API Key。",403:"该密钥没有读取模型列表的权限。",404:"此供应商不支持模型列表，请手动填写模型 ID。",429:"请求过于频繁，请稍后重试。"})[response.status] || `获取模型失败（HTTP ${response.status}）。`);
  const body = await response.json();
  if (!Array.isArray(body?.data)) throw new Error("供应商返回的模型列表格式不兼容，请手动填写模型 ID。");
  const seen = new Set();
  const models = body.data.filter(item => typeof item?.id === "string" && item.id.trim() && item.id.length <= 300 && !seen.has(item.id) && seen.add(item.id))
    .slice(0, 5000).map(item => ({ id: item.id, name: typeof item.name === "string" ? item.name.slice(0,200) : item.id }));
  if (!models.length) throw new Error("供应商未返回模型，请手动填写模型 ID。");
  return models.sort((a,b) => a.id.localeCompare(b.id));
}

// Shared by the dashboard and onboarding. Catalog and credentials stay in the
// extension page; no persistence or background message exposes them to sites.
export function attachModelCatalog(getConfig) {
  const input = document.querySelector("#modelInput");
  const box = document.createElement("div"); box.className = "model-catalog";
  box.innerHTML = `<button type="button" class="qa-secondary">获取模型列表</button><p class="note" role="status" aria-live="polite"></p><div class="is-hidden"><input type="search" placeholder="搜索模型名称或 ID" aria-label="搜索供应商模型"><div class="catalog-results" aria-label="供应商模型列表"></div></div>`;
  input.closest("label").after(box);
  const button = box.querySelector("button"), status = box.querySelector("p"), panel = box.querySelector("div"), search = box.querySelector("input"), list = box.querySelector(".catalog-results");
  let models = [], revision = 0, controller;
  function reset() {
    revision++; controller?.abort(); models = []; panel.classList.add("is-hidden"); list.replaceChildren(); search.value = ""; status.textContent = ""; button.disabled = false;
  }
  function render() {
    const query = search.value.trim().toLowerCase();
    const matches = models.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(query));
    list.replaceChildren(...matches.slice(0,100).map(model => {
      const row = document.createElement("button"); row.type = "button"; row.className = "catalog-model";
      const name = document.createElement("strong"), id = document.createElement("small"); name.textContent = model.name; id.textContent = model.id;
      row.append(name,id); row.onclick = () => { input.value = model.id; input.dispatchEvent(new Event("input",{bubbles:true})); status.textContent = `已选择 ${model.id}，保存配置后生效。`; panel.classList.add("is-hidden"); };
      return row;
    }));
    if (!matches.length) list.textContent = "没有匹配模型，可以直接在模型名称中手动填写。";
    else if(matches.length>100) { const hint=document.createElement("p"); hint.textContent=`共 ${matches.length} 个结果，显示前 100 个；输入关键词缩小范围。`; list.append(hint); }
  }
  search.oninput = render;
  for (const id of ["providerInput","baseUrlInput","apiKeyInput"]) document.getElementById(id).addEventListener("input",reset);
  button.onclick = async () => {
    reset(); const current = revision; controller = new AbortController(); const request = controller;
    let timer;
    try {
      const raw = getConfig();
      if (raw.provider !== "zhida") {
        const config = resolveConfig(raw);
        // Permission must be requested in the click gesture.
        const permission = chrome.permissions.request({origins:[`${new URL(config.baseURL).origin}/*`]});
        button.disabled=true; status.textContent="正在获取模型列表…";
        if(!await permission) throw new Error("未获得 API 域名权限，请允许后重试。");
      }
      if(current!==revision) return;
      timer=setTimeout(()=>request.abort(),15000);
      const fetched=await fetchModels(raw,fetch,request.signal);
      if(current!==revision) return;
      models=fetched;
      status.textContent=`已获取 ${models.length} 个模型。列表由供应商返回，实际调用权限与提问兼容性需试生成确认。`;
      panel.classList.remove("is-hidden"); render();
    } catch(error) {
      if(current===revision) status.textContent=error.name==="AbortError" ? "获取超时，请重试或手动填写模型 ID。" : error instanceof TypeError ? "无法读取模型列表，请检查网络和 API 地址，或手动填写。" : error.message;
    } finally { clearTimeout(timer); if(current===revision) button.disabled=false; }
  };
  return {reset};
}
