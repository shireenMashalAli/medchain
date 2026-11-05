import { cn } from "@/lib/utils";

const KEYWORDS = /\b(contract|function|rule|require|returns|return|struct|param|emit|for|in|if|IN|true|false)\b/g;

function highlight(line: string) {
  const comment = line.indexOf("//");
  const code = comment >= 0 ? line.slice(0, comment) : line;
  const rest = comment >= 0 ? line.slice(comment) : "";
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(KEYWORDS)) {
    parts.push(code.slice(last, m.index));
    parts.push(<span key={m.index} className="text-sky-300">{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  parts.push(code.slice(last));
  if (rest) parts.push(<span key="c" className="text-slate-500 italic">{rest}</span>);
  return parts;
}

// `marks` colours individual lines (for diffs): "add" | "remove" | "baseline".
export function CodeViewer({ code, marks, className, maxHeight = "28rem" }: { code: string; marks?: Record<number, "add" | "remove" | "baseline">; className?: string; maxHeight?: string }) {
  const lines = code.split("\n");
  return (
    <div className={cn("overflow-auto rounded-md bg-[#0b1d36] font-mono text-xs leading-5 text-slate-200", className)} style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={cn(marks?.[i] === "add" && "bg-emerald-500/15", marks?.[i] === "remove" && "bg-red-500/20", marks?.[i] === "baseline" && "bg-teal-400/5")}>
              <td className="w-10 pr-3 pl-3 text-right text-slate-500 select-none">{i + 1}</td>
              <td className="w-4 text-slate-400 select-none">{marks?.[i] === "add" ? "+" : marks?.[i] === "remove" ? "−" : ""}</td>
              <td className="pr-4 whitespace-pre">{highlight(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Minimal line diff (LCS) for comparing two contract versions.
export function diffLines(a: string, b: string) {
  const x = a.split("\n"), y = b.split("\n");
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { type: "same" | "add" | "remove"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ type: "same", text: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "remove", text: x[i++] });
    else out.push({ type: "add", text: y[j++] });
  }
  while (i < x.length) out.push({ type: "remove", text: x[i++] });
  while (j < y.length) out.push({ type: "add", text: y[j++] });
  return out;
}

export function DiffViewer({ from, to }: { from: string; to: string }) {
  const d = diffLines(from, to);
  const marks: Record<number, "add" | "remove"> = {};
  d.forEach((l, i) => { if (l.type !== "same") marks[i] = l.type; });
  return <CodeViewer code={d.map((l) => l.text).join("\n")} marks={marks} />;
}
