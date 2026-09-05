const fs = require('fs');
let code = fs.readFileSync('channels.ts', 'utf8');

const target = `export const NETWORK_CHANNELS: NetworkChannelConfig[] = [
  { id: "fox-news", displayName: "Fox News", network: "FOXNEWSW" },
  { id: "cnn", displayName: "CNN", network: "CNNW" },
  { id: "msnbc", displayName: "MSNBC", network: "MSNBCW" },
];`;

const replacement = `export const NETWORK_CHANNELS: NetworkChannelConfig[] = [
  { id: "fox-news", displayName: "Fox News", network: "FOXNEWSW" },
  { id: "cnn", displayName: "CNN", network: "CNNW" },
  { id: "msnbc", displayName: "MSNBC", network: "MSNBCW" },
  { id: "bbc", displayName: "BBC News", network: "BBCNEWS" },
  { id: "ntd", displayName: "NTD News", network: "TV-NTD" },
];`;

code = code.replace(target, replacement);

fs.writeFileSync('channels.ts', code);
