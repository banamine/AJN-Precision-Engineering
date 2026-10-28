import { resolveBestFileUrl } from "./channels.ts";
resolveBestFileUrl("FOXNEWSW_20260905_210000").then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error);
