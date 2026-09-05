const fs = require('fs');
let lines = fs.readFileSync('src/components/PlayerView.tsx', 'utf8').split('\n');

const toRemoveStart = lines.findIndex(l => l.startsWith("import { useStat"));
const toRemoveEnd = lines.findIndex(l => l.includes("Auto-advance failed"));

lines.splice(toRemoveStart, toRemoveEnd - toRemoveStart + 2, "import { useState, useEffect } from 'react';");

fs.writeFileSync('src/components/PlayerView.tsx', lines.join('\n'));
