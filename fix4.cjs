const fs = require('fs');
let lines = fs.readFileSync('src/components/PlayerView.tsx', 'utf8').split('\n');

// Drop the first two broken lines
lines = lines.slice(2);
// Ensure import { useState, useEffect } from 'react'; is at the top
lines.unshift("import { useState, useEffect } from 'react';");

fs.writeFileSync('src/components/PlayerView.tsx', lines.join('\n'));
