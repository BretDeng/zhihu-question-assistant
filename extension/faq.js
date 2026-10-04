// Shared by the dashboard and the guide. Quoted error texts must match the
// messages thrown in the extension so users can search by pasting them.
export const FAQ = [
  {
    group: "配置模型与密钥",
    items: [
      {
        q: "如何获取知乎直答的 Access Secret？",
        steps: [
          "打开知乎数据开放平台 developer.zhihu.com，点右上角「注册」或「登录」，使用知乎账号登录（支持手机验证码或知乎 App 扫码）。",
          "登录后进入「个人中心」（developer.zhihu.com/profile），在这里创建密钥并复制 Access Secret。",
          "回到本扩展，点「添加配置」，提供方选「知乎直答」，把 Access Secret 粘贴到「API Key / Access Secret」，点「保存并使用」。",
        ],
        a: ["平台注册后提供免费调用额度（官网标注为每天 5000 次，以平台最新说明为准）。Access Secret 等同于账号凭证，请勿分享或发到公开场合；泄露后请在个人中心重新创建。"],
      },
      {
        q: "知乎直答的三个模型有什么区别？",
        a: ["zhida-agent 为默认档位，效果均衡；zhida-fast-1p5 响应更快，适合频繁使用；zhida-thinking-1p5 会进行更深入的思考，效果可能更好但耗时更长。不确定时先用默认档位，觉得慢再换快速档位。"],
      },
      {
        q: "可以使用哪些第三方 API？",
        a: [
          "任何兼容 OpenAI /chat/completions 接口的 HTTPS 服务都可以，例如 OpenAI、DeepSeek、Kimi（月之暗面）、阿里云百炼（兼容模式）、硅基流动、OpenRouter，以及自建的 One API 等中转服务。",
          "API 地址一般填到 /v1 为止，例如 https://api.openai.com/v1、https://api.deepseek.com/v1、https://api.moonshot.cn/v1、https://dashscope.aliyuncs.com/compatible-mode/v1，具体以服务商文档为准。误填完整的 …/chat/completions 也会被自动修正。",
          "出于安全考虑只支持 HTTPS，本机的 http://localhost（如 Ollama）无法直接使用。",
        ],
      },
      {
        q: "提示「API Base URL 必须是无账号、查询参数和片段的 HTTPS 地址」",
        a: ["地址必须以 https:// 开头，且不能带 ?key=… 这类查询参数、# 片段或 user:password@ 账号信息。密钥请填在「API Key」一栏，不要拼在地址里。"],
      },
      {
        q: "提示「未授予该 API 域名访问权限，配置未保存」",
        a: ["保存第三方 API 时，浏览器会弹窗询问是否允许扩展访问该域名，需要点「允许」。如果误点了拒绝，再点一次「保存并使用」即可重新弹出。"],
      },
      {
        q: "提示「API 域名已改变，请填写对应服务的新密钥」",
        a: ["这是安全保护：修改配置的 API 地址到另一个域名时，原密钥不会被发送给新域名。请同时填写新服务的密钥。"],
      },
      {
        q: "重启浏览器后显示「需补充密钥」或「请先在扩展设置中填写 API Key」",
        a: ["保存时没有勾选「在这台设备上记住密钥」，密钥只保留到浏览器关闭。编辑该配置重新填写密钥，并勾选记住即可。"],
      },
      {
        q: "提示「请先在模型面板添加并启用一套模型配置」",
        a: ["还没有任何模型配置，或正在使用的配置已被删除。点「添加配置」新建，或在列表中点某套配置的「使用」。"],
      },
      {
        q: "提示「请选择有效的知乎直答模型档位」",
        a: ["知乎直答只支持 zhida-agent、zhida-fast-1p5、zhida-thinking-1p5 三个模型名称。编辑配置，在「模型名称」下拉中选择其一。"],
      },
    ],
  },
  {
    group: "生成草稿时的报错",
    items: [
      {
        q: "提示「当前页面正文较少，可以先选中一段文字再分析」",
        a: ["页面可能尚未加载完，或主要内容在图片、视频、PDF 里。等待加载后重试，或用鼠标选中至少一段文字再点「分析当前网页」。"],
      },
      {
        q: "提示「未找到可靠的文章正文」或「未抓取到网页正文」",
        a: ["这是「网页原文」模式的保护：识别不到文章正文时不会把菜单、广告等杂项当成原文。请等待正文加载后重试，或切换为「概括提问」并选中所需内容。"],
      },
      {
        q: "提示「网页正文超过 20 万字符，无法完整保存」",
        a: ["原文模式不会截断原文。正文过长时请改用「概括提问」，或选中需要的部分后在概括模式下分析。"],
      },
      {
        q: "提示「密钥无效，请检查 API Key」（HTTP 401）",
        a: ["密钥填错、复制不完整、已过期或被删除。重新从服务商（知乎直答在个人中心）复制完整密钥，编辑配置后保存。注意不要多复制空格或换行。"],
      },
      {
        q: "提示「账号无权访问该模型」（HTTP 403）",
        a: ["账号没有开通该模型，或账户欠费、被限制。请在服务商控制台确认模型权限和账户状态，或换一个已开通的模型。"],
      },
      {
        q: "提示「接口或模型不存在」（HTTP 404）或「请求被拒绝」（HTTP 400）",
        a: ["最常见原因是 API 地址少了 /v1（或多了路径），或模型名称拼写与服务商文档不一致（区分大小写）。错误信息后面附有服务商返回的原文，可据此定位。"],
      },
      {
        q: "提示「调用频率过高或额度不足」（HTTP 429）",
        a: ["短时间内请求过多，或当日 / 账户额度已用完。稍等片刻重试；知乎直答可在开放平台查看额度；也可以切换到另一套模型配置。"],
      },
      {
        q: "提示「模型请求失败（HTTP 500/502/503…）」",
        a: ["服务商暂时故障或过载，与扩展设置无关。稍后重试，或先换一套模型配置。"],
      },
      {
        q: "提示「模型请求超时，请重试或选择更快的模型」",
        a: ["模型 25 秒内没有开始响应，或 3 分钟内没有生成完。可换用更快的模型（如 zhida-fast-1p5），检查网络 / 代理，或选中更短的内容后再分析。"],
      },
      {
        q: "提示「无法连接模型 API，请检查 HTTPS 地址、网络与扩展的网站访问权限」",
        a: ["请求没能发出或被中断：检查 API 地址是否拼写正确、网络或代理是否可访问该服务；如果保存时拒绝过域名权限，重新保存配置并点「允许」。"],
      },
      {
        q: "提示「模型生成中断，请检查额度或重试」",
        a: ["模型在生成过程中返回了错误，常见于额度耗尽或服务端中断。已生成的草稿会保留，可直接重试。"],
      },
      {
        q: "提示「模型返回的不是有效 JSON」「缺少 items 列表」或「没有返回有效的提问草稿」",
        a: ["模型没有按要求的格式输出。重试一次通常即可；若反复出现，请换用指令遵循能力更强的模型。推理模型输出的 <think> 思考过程会被自动忽略。"],
      },
      {
        q: "生成的草稿不足 6 个",
        a: ["模型少写了草稿，或部分草稿缺少标题、话题建议而被自动跳过。已有草稿可以正常使用，需要更多角度时再分析一次。"],
      },
      {
        q: "提示「扩展已更新或重新加载，请刷新此网页后重试」",
        a: ["更新、重新加载或重新启用扩展后，已经打开的网页仍连着旧版本。刷新该网页即可。"],
      },
      {
        q: "提示「此网站已停用插件，可在面板的网站过滤中恢复」",
        a: ["该网站在「网站过滤」排除列表里。在设置面板删除对应域名并保存，即可恢复。"],
      },
    ],
  },
  {
    group: "知乎自动填写与话题",
    items: [
      {
        q: "提示「未找到提问入口。请登录知乎…」",
        a: ["知乎未登录，或页面还没加载完。登录知乎后，手动点页面上的「提问题」，再点草稿面板中的「打开提问并填写」。"],
      },
      {
        q: "提示「提问框未打开」或「提问框内容已发生变化，停止自动填写」",
        a: ["知乎的提问弹窗没有按预期打开，或你在填写过程中改动了内容。手动打开提问框后点「打开提问并填写」重试，或用「复制」按钮手动粘贴。"],
      },
      {
        q: "提示「提问框已有其他标题，未覆盖任何内容」或「已保留现有问题描述，没有覆盖」",
        a: ["为避免误删，助手从不覆盖你已经写好的内容。清空提问框中的标题或描述后重试，或自行编辑。"],
      },
      {
        q: "提示「未找到描述编辑器」或「知乎未接受自动粘贴」",
        a: ["标题已填好，但知乎编辑器拒绝了自动输入。点草稿面板「问题描述」旁的「复制」，再到知乎描述框里按 Ctrl/Cmd+V 粘贴（会附带引用来源链接）。"],
      },
      {
        q: "话题没有全部绑定，显示「待手动确认」",
        a: ["为避免绑错，助手只选择知乎上名称完全一致的已有话题。可以在草稿面板把话题建议改成更常见的名称（如「人工智能」而非「AI 技术发展」），再点「重新匹配话题」；也可以在知乎里手动搜索选择。"],
      },
      {
        q: "提示「未找到话题选择入口」「话题选择器未就绪」或「知乎未确认绑定结果」",
        a: ["知乎页面结构变化或加载较慢。稍等后点「重新匹配话题」，或在提问框中点 # 按钮手动添加话题。"],
      },
      {
        q: "知乎页面上的「提问草稿」面板什么时候消失？",
        a: ["问题发布成功后会自动关闭；点 × 可随时关闭（不会清除知乎里已填写的内容）。草稿只保存在当前标签页，关闭标签页或超过 24 小时后自动清除。"],
      },
    ],
  },
  {
    group: "其他",
    items: [
      {
        q: "某些网页上看不到「问」按钮",
        a: ["浏览器内置页面（chrome:// 设置页、新标签页、扩展商店）和浏览器自带的 PDF 预览不允许扩展运行；安装或更新扩展之前就打开的页面需要刷新；网站可能在「网站过滤」排除列表中；网页内嵌框架里也不会显示。"],
      },
      {
        q: "「问」按钮挡住了网页内容",
        a: ["按住「问」拖到合适位置即可，位置会被记住并用于所有网站；面板标题栏也可以拖动，按 Esc 收起面板。想恢复到右下角，在设置面板点「恢复「问」按钮默认位置」。"],
      },
      {
        q: "选中文字和整页分析有什么区别？",
        a: ["选中文字时，模型优先围绕选中内容提问，正文只作简短背景；不选中时使用识别到的文章正文。想聚焦某个观点时，先选中再分析效果更好。"],
      },
      {
        q: "我的密钥和网页内容安全吗？",
        a: ["密钥只保存在扩展内部存储（不同步云端），网页脚本无法读取，只会发送到你配置的 API 地址。网页内容只在你点击「分析当前网页」时发送给你选择的模型；插件没有自己的服务器，也不会替你发布任何内容。"],
      },
    ],
  },
];

export function renderFaq(container, searchInput) {
  const entries = [];
  const groups = FAQ.map(({ group, items }) => {
    const section = document.createElement("section");
    section.className = "faq-group";
    const heading = document.createElement("h3");
    heading.textContent = group;
    section.append(heading);
    for (const item of items) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = item.q;
      details.append(summary);
      if (item.steps) {
        const list = document.createElement("ol");
        for (const step of item.steps) { const li = document.createElement("li"); li.textContent = step; list.append(li); }
        details.append(list);
      }
      for (const text of item.a || []) { const p = document.createElement("p"); p.textContent = text; details.append(p); }
      section.append(details);
      entries.push({ details, section, text: `${item.q} ${(item.steps || []).join(" ")} ${(item.a || []).join(" ")}`.toLowerCase() });
    }
    return section;
  });
  const empty = document.createElement("p");
  empty.className = "faq-empty is-hidden";
  empty.textContent = "没有找到相关问题。可以尝试输入报错里的几个关键字，例如「超时」「401」「话题」。";
  container.replaceChildren(...groups, empty);
  if (!searchInput) return;
  searchInput.addEventListener("input", () => {
    // Ignore quotes and punctuation so a pasted error message still matches.
    const terms = searchInput.value.toLowerCase().split(/[\s，。,.!！?？「」『』"“”'：:；;（）()]+/).filter(Boolean);
    // Pasted messages may carry extra text; fall back to the entries sharing
    // the most keyword characters with the query.
    let test = (entry) => terms.every((term) => entry.text.includes(term));
    if (terms.length && !entries.some(test)) {
      const score = (entry) => terms.reduce((sum, term) => sum + (term.length >= 2 && entry.text.includes(term) ? term.length : 0), 0);
      const best = Math.max(...entries.map(score));
      test = (entry) => best > 0 && score(entry) >= best * 0.75;
    }
    let shown = 0;
    for (const entry of entries) {
      const match = test(entry);
      entry.details.classList.toggle("is-hidden", !match);
      entry.details.open = Boolean(terms.length && match);
      if (match) shown++;
    }
    for (const section of groups) section.classList.toggle("is-hidden", !section.querySelector("details:not(.is-hidden)"));
    empty.classList.toggle("is-hidden", shown > 0);
  });
}
