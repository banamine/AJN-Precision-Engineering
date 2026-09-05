import fs from "fs";

let content = fs.readFileSync("src/components/PlayerView.tsx", "utf-8");

const start = content.indexOf("const handleProgramEnded = async () => {");
const end = content.indexOf("</script>") > -1 ? content.indexOf("</script>") : content.indexOf("    <MinimalPlayer src={nowPlaying.src} title={nowPlaying.title} onProgramEnded={handleProgramEnded} />");

const funcDef = content.substring(start, content.indexOf("  };", start) + 4);

content = content.replace(funcDef, "");

const effectEnd = content.indexOf("}, [nowPlaying]);") + 17;
content = content.substring(0, effectEnd) + "\n\n" + funcDef + content.substring(effectEnd);

fs.writeFileSync("src/components/PlayerView.tsx", content);
