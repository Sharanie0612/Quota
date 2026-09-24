//! 本机跑不了 `cargo test`（测试 harness 缺 DLL 入口），这个 example 用与主程序相同的
//! 代码路径真正执行「过时模型隐藏」逻辑，作为可运行的验证。
//! 运行：cargo run --release --example hidden_check

use quota_lib::{
    cards_for_account, embedded_file, hidden_keys, is_hidden, merge_cards, normalize,
    CatalogEntry, RemoteModel,
};

fn main() {
    // 1. 内置资料库能解析，且确实标了 hidden 条目
    let file = embedded_file();
    assert!(file.entries.len() >= 10, "内置资料库条目太少：{}", file.entries.len());
    let keys = hidden_keys(&file.entries);
    assert!(keys.len() >= 40, "hidden 键太少（条目没标上 hidden？）：{}", keys.len());

    // 2. 过时/已下线的历史 id 必须被隐藏
    let should_hide = [
        // DeepSeek：V3/R1 代际 + 历史别名
        "deepseek-chat",
        "deepseek-reasoner",
        "deepseek-v3",
        "deepseek-ai/DeepSeek-V3-20250929",
        "DeepSeek-R1-0528",
        // GLM：已淘汰的旧名（glm-4.6/4.5-air/4-flash 已补现役条目，挪到 rescued 组）
        "glm-z1",
        "glm-3-plus",
        // OpenAI：旧 GPT / o 系列（含日期快照）
        "gpt-4o",
        "gpt-4o-2024-05-13",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-5",
        "gpt-5-mini",
        "o3",
        "o4-mini",
        "o1-preview",
        "gpt-3.5-turbo",
        "gpt-4-turbo",
        // Kimi / Moonshot：已下线系列
        "kimi-latest",
        "moonshot-v1-8k",
        "moonshot-v1-128k-vision-preview",
        "kimi-k2.5",
        "kimi-k2-0905-preview",
        "kimi-k2-thinking",
        "kimi-thinking-preview",
        // MiMo：v2.5 对话档 2026-10-21 停用，已被 v2.6 取代（注意不能带上语音档）
        "mimo-v2.5",
        "mimo-v2.5-pro",
        // 其他厂商历史 id
        "claude-3-5-sonnet-20241022",
        "claude-2.1",
        "claude-instant-1.2",
        "gemini-1.5-pro",
        "gemini-2.5-flash",
        "qwen2.5-72b-instruct",
    ];
    for id in should_hide {
        assert!(is_hidden(&keys, id), "应当被隐藏但没有：{id}（归一化：{}）", normalize(id));
    }

    // 3. 在售/当前的 id 绝不能被误伤（尤其带点号的新版本号）
    let should_keep = [
        "deepseek-flash",
        "deepseek-v4.1-flash",
        "deepseek-v4-pro",
        "deepseek-v3.2", // 硅基流动仍在售的上代部署，未标 hidden 就应照常显示
        "mimo-v2.6-pro",
        "kimi-k3",
        "kimi-k2.7-code",
        "kimi-k2.6",
        "glm-5.3",
        "glm-5.3-flash",
        "glm-4.7-flash",
        "glm-4.6v",
        "gpt-5.5",
        "gpt-5.6-sol",
        "gpt-6-astra",
        "claude-sonnet-5",
        "claude-opus-4-8",
        "gemini-3.8-flash",
        "qwen3.8-max",
    ];
    for id in should_keep {
        assert!(!is_hidden(&keys, id), "误伤在售模型：{id}（归一化：{}）", normalize(id));
    }

    // 4. 会被隐藏键的 `-` 前缀扫到、但要靠「精确资料兜底」在卡片生成层救回来的现役 id
    //    （键层 is_hidden 对它们是 true，所以只能在下面的端到端用例里断言）
    let rescued = [
        "mimo-v2.5-asr",
        "mimo-v2.5-tts",
        "mimo-v2.5-tts-voiceclone",
        "mimo-v2.5-tts-voicedesign",
        // 这三个还在官方价目表里（或免费/官网未列价），有现役条目兜底
        "glm-4.6",
        "glm-4.5-air",
        "glm-4-flash-250414",
    ];
    for id in rescued {
        assert!(is_hidden(&keys, id), "前置条件不成立：{id} 应被 mimo-v2.5 前缀键扫到");
    }

    // 5. 端到端：卡片生成确实丢弃了过时模型、救回语音档，且本地覆盖可以救回来
    let models: Vec<RemoteModel> = should_hide
        .iter()
        .chain(should_keep.iter())
        .chain(rescued.iter())
        .map(|id| RemoteModel {
            id: id.to_string(),
            ..Default::default()
        })
        .collect();
    let cards = merge_cards(cards_for_account("custom", "acc", &models, &file.entries, &[]));
    let shown: Vec<&str> = cards.iter().map(|c| c.id.as_str()).collect();
    for id in should_hide {
        assert!(!shown.contains(&id), "过时模型出现在模型列表里：{id}");
    }
    for id in should_keep.iter().chain(rescued.iter()) {
        assert!(shown.contains(&id), "在售模型被错误丢弃：{id}");
    }

    // 本地覆盖里显式编辑过的条目优先于隐藏标记
    let override_entry = CatalogEntry {
        r#match: vec!["deepseek-chat".into()],
        name: "用户手动保留的卡片".into(),
        ..Default::default()
    };
    let cards = cards_for_account(
        "custom",
        "acc",
        &[RemoteModel {
            id: "deepseek-chat".into(),
            ..Default::default()
        }],
        &file.entries,
        &[override_entry],
    );
    assert_eq!(cards.len(), 1, "本地覆盖过的条目不应被隐藏");

    println!(
        "OK：hidden 键 {} 个；隐藏 {} 个、保留 {} 个；覆盖条目 1 个全部符合预期。",
        keys.len(),
        should_hide.len(),
        should_keep.len()
    );
}
