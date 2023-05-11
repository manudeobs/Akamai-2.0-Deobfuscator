# Akamai-2.0-Deobfuscator

This repository contains a fully functional akamai 2.0 deobfuscator (as of wWAHTlbNzK script). All necessary steps to recover a well readable and understandable state including removal of.

Most important transformations included:
- Patching integrity checks
- Proxy functions removal
- Control flow unflattening
- String concealing removal

I can't tell if I'm going to maintain this yet but it'll always serve as a good source to dive deeper into babel, learn new things and understand other people's approaches.

# Usage

1. Install all dependencies: `npm install`

2. Save the akamai script as `script.js` next to `index.js` in it's minified format (one liner format), don't pretty print.

3. Run `node index.js` as enjoy your deobfuscated script in `out.js`
