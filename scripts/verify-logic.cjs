/* 校验 Rust 侧纯函数的逻辑：把 src-tauri/src/{aliyun,pricing}.rs 里的同名函数
   按同样规则移植到 JS，再用「阿里云官方文档给出的签名示例」和 Rust 单测里的断言
   逐条核对。仅用于本项目自检，不参与打包。用法：node scripts/verify-logic.cjs */
const crypto = require("crypto");
const assert = require("assert");

/* ---------------- aliyun.rs: percent_encode / canonical_query / sign ---------------- */

function percentEncode(input) {
  let out = "";
  for (const byte of Buffer.from(input, "utf8")) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(c)) out += c;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function canonicalQuery(params) {
  return params
    .slice()
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join("&");
}

function sign(canonical, accessKeySecret) {
  const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonical)}`;
  return crypto
    .createHmac("sha1", `${accessKeySecret}&`)
    .update(stringToSign, "utf8")
    .digest("base64");
}

/* ---------------- pricing.rs: numbers_in / html_to_lines ---------------- */

function numbersIn(line) {
  const chars = [...line];
  const out = [];
  let i = 0;
  const currency = (c) => "¥￥$€".includes(c);
  const isIdentifier = (c) => /[A-Za-z0-9\-_.]/.test(c);
  while (i < chars.length) {
    if (!/[0-9]/.test(chars[i])) {
      i++;
      continue;
    }
    if (i > 0 && isIdentifier(chars[i - 1]) && !currency(chars[i - 1])) {
      i++;
      continue;
    }
    let buf = "";
    while (i < chars.length) {
      const d = chars[i];
      if (/[0-9]/.test(d)) {
        buf += d;
        i++;
      } else if (d === "," && /[0-9]/.test(chars[i + 1] || "")) {
        i++;
      } else if (d === "." && /[0-9]/.test(chars[i + 1] || "") && !buf.includes(".")) {
        buf += ".";
        i++;
      } else break;
    }
    const followedByLetter = i < chars.length && /[A-Za-z]/.test(chars[i]);
    if (!followedByLetter) {
      const v = Number(buf);
      if (!Number.isNaN(v)) out.push(v);
    }
  }
  return out;
}

const BLOCK = new Set([
  "br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "table", "section", "article",
]);
const SKIP = ["script", "style", "noscript", "svg"];

function startsWithCi(chars, i, needle) {
  if (chars.length - i < needle.length) return false;
  for (let k = 0; k < needle.length; k++) {
    if (chars[i + k].toLowerCase() !== needle[k].toLowerCase()) return false;
  }
  return true;
}

function htmlToLines(html) {
  let text = "";
  const chars = [...html];
  let i = 0;
  let skipUntil = null;
  while (i < chars.length) {
    if (skipUntil) {
      if (startsWithCi(chars, i, `</${skipUntil}`)) {
        while (i < chars.length && chars[i] !== ">") i++;
        i++;
        skipUntil = null;
      } else i++;
      continue;
    }
    if (chars[i] === "<") {
      let skipping = false;
      for (const t of SKIP) {
        if (startsWithCi(chars, i, `<${t}`)) {
          skipUntil = t;
          skipping = true;
          break;
        }
      }
      if (skipping) {
        i++;
        continue;
      }
      let j = i + 1;
      let name = "";
      while (j < chars.length && !/\s/.test(chars[j]) && chars[j] !== ">") {
        name += chars[j];
        j++;
      }
      name = name.replace(/^\//, "").toLowerCase();
      text += BLOCK.has(name) ? "\n" : " ";
      while (i < chars.length && chars[i] !== ">") i++;
      i++;
      continue;
    }
    text += chars[i];
    i++;
  }
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.split(/\s+/).filter(Boolean).join(" "))
    .filter(Boolean);
}

/* ---------------- 断言 ---------------- */

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", `${name} :: ${e.message}`]);
  }
};

// 1) 阿里云官方文档的签名示例（最强的一条外部校验）
check("阿里云签名示例 = 9NaGiOspFP5UPcwX8Iwt2YJXXuk=", () => {
  const params = [
    ["Action", "DescribeDedicatedHosts"],
    ["Version", "2014-05-26"],
    ["Format", "JSON"],
    ["AccessKeyId", "testid"],
    ["SignatureNonce", "edb2b34af0af9a6d14deaf7c1a5315eb"],
    ["Timestamp", "2023-03-13T08:34:30Z"],
    ["RegionId", "cn-beijing"],
    ["SignatureMethod", "HMAC-SHA1"],
    ["SignatureVersion", "1.0"],
  ];
  const sig = sign(canonicalQuery(params), "testsecret");
  assert.strictEqual(sig, "9NaGiOspFP5UPcwX8Iwt2YJXXuk=");
});

// 2) 百分号编码规则
check("percent_encode 规则", () => {
  assert.strictEqual(percentEncode("a b"), "a%20b");
  assert.strictEqual(percentEncode("a*b"), "a%2Ab");
  assert.strictEqual(percentEncode("a~b"), "a~b");
  assert.strictEqual(percentEncode("/"), "%2F");
  assert.strictEqual(percentEncode("a=b&c"), "a%3Db%26c");
  assert.strictEqual(percentEncode("sk-abc_1.2"), "sk-abc_1.2");
});

// 3) canonical_query 排序
check("canonical_query 排序", () => {
  assert.strictEqual(
    canonicalQuery([["Version", "2017-12-14"], ["Action", "QueryAccountBalance"]]),
    "Action=QueryAccountBalance&Version=2017-12-14",
  );
});

// 4) numbers_in：排除版本号片段与带字母单位的数量（Rust 单测同款用例）
check("numbers_in 排除版本号与 1M/128K", () => {
  assert.deepStrictEqual(numbersIn("glm-4.6 输入 ¥1.5 输出 ¥6"), [1.5, 6]);
  assert.deepStrictEqual(numbersIn("kimi-k2.7-code 每 1M tokens ¥6.5"), [6.5]);
  assert.deepStrictEqual(numbersIn("gpt-4o $2.50 美元"), [2.5]);
  assert.deepStrictEqual(numbersIn("1,024.50"), [1024.5]);
  assert.deepStrictEqual(numbersIn("deepseek-v4-pro"), []);
  assert.deepStrictEqual(numbersIn("每 1M tokens"), []);
  assert.deepStrictEqual(numbersIn("mimo-v2.6-pro 输入 ¥3.00 输出 ¥6.00"), [3, 6]);
});

// 5) html_to_lines：去脚本/样式、表格按行成行
check("html_to_lines 去脚本并保留表格行", () => {
  const html =
    "<html><head><style>.a{color:red}</style><script>var x=1;</script></head>" +
    "<body><h1>定价</h1><table><tr><td>输入</td><td>$0.5</td></tr>" +
    "<tr><td>输出</td><td>$2</td></tr></table></body></html>";
  const lines = htmlToLines(html);
  assert.ok(lines.some((l) => l.includes("定价")), "应保留标题");
  assert.ok(lines.some((l) => l.includes("输入") && l.includes("$0.5")), "输入行应完整");
  assert.ok(lines.some((l) => l.includes("输出") && l.includes("$2")), "输出行应完整");
  assert.ok(!lines.some((l) => l.includes("var x")), "脚本内容应被丢弃");
  assert.ok(!lines.some((l) => l.includes("color:red")), "样式内容应被丢弃");
  assert.ok(!lines.some((l) => l.includes("/script")), "结束标签不应变成正文");
  assert.ok(!lines.some((l) => l.includes("/style")), "结束标签不应变成正文");
});

// 6) 真实定价页文本端到端：从抓到的行里能抽出价格候选
check("真实定价页文本可抽出候选价", () => {
  const lines = htmlToLines(`
    <table>
      <tr><td>mimo-v2.6-pro</td><td>输入（缓存未命中）</td><td>¥3.00</td><td>输出</td><td>¥6.00</td></tr>
      <tr><td>mimo-v2.6-flash</td><td>输入（缓存未命中）</td><td>¥1.00</td><td>输出</td><td>¥2.00</td></tr>
    </table>`);
  const pro = lines.find((l) => l.includes("mimo-v2.6-pro"));
  assert.ok(pro, "应能找到 pro 行");
  const nums = numbersIn(pro);
  assert.deepStrictEqual(nums.slice(0, 2), [3, 6], `pro 行候选价应为 3/6，实际 ${nums}`);
  const flash = lines.find((l) => l.includes("mimo-v2.6-flash"));
  assert.deepStrictEqual(numbersIn(flash).slice(0, 2), [1, 2], "flash 行候选价应为 1/2");
});

// 7) 自定义余额接口的请求头防呆（移植 custom.rs::first_header_without_colon）
const firstHeaderWithoutColon = (raw) => {
  const lines = raw.split("\n").map((l) => l.trim());
  const idx = lines.findIndex((l) => l !== "" && !l.startsWith("#") && !l.includes(":"));
  return idx === -1 ? null : idx + 1;
};
check("请求头缺冒号能被检测出来", () => {
  assert.strictEqual(firstHeaderWithoutColon("ois1.eyJ2IjoxLCJhbGc"), 1);
  assert.strictEqual(firstHeaderWithoutColon("Cookie: a=1\nbad-line"), 2);
  assert.strictEqual(firstHeaderWithoutColon("Cookie: a=1\nX-T: y"), null);
  assert.strictEqual(firstHeaderWithoutColon("\n# c\nCookie: a=1"), null);
  assert.strictEqual(firstHeaderWithoutColon(""), null);
});

let failed = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
