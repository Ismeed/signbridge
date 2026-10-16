const fs = require('fs');
const path = require('path');
const { compile } = require('tailwindcss');

async function build() {
  const inputCss = fs.readFileSync(path.join(__dirname, '../src/app/input.css'), 'utf8');
  console.log('Compiling CSS from input.css...');

  const compiler = await compile(inputCss, {
    base: path.join(__dirname, '../src/app'),
    async loadStylesheet(id, base) {
      if (id === 'tailwindcss' || id === 'tailwindcss/index.css') {
        const twPath = path.join(__dirname, '../node_modules/tailwindcss/index.css');
        return {
          base: path.dirname(twPath),
          content: fs.readFileSync(twPath, 'utf8'),
        };
      }
      let target = path.resolve(base || __dirname, id);
      if (!fs.existsSync(target) && !target.endsWith('.css')) {
        target += '.css';
      }
      return {
        base: path.dirname(target),
        content: fs.readFileSync(target, 'utf8'),
      };
    },
  });

  // Scan all classes from src
  const classes = new Set();
  function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        scanDir(full);
      } else if (f.endsWith('.tsx') || f.endsWith('.ts')) {
        const content = fs.readFileSync(full, 'utf8');
        // Match className strings and tokens
        const matches = content.match(/["'`]([^"'`]+)["'`]/g) || [];
        matches.forEach(m => {
          const raw = m.slice(1, -1);
          raw.split(/\s+/).forEach(token => {
            if (token && !token.includes('${') && !token.includes('\n')) {
              classes.add(token.trim());
            }
          });
        });
      }
    }
  }

  scanDir(path.join(__dirname, '../src'));
  console.log(`Found ${classes.size} candidate tokens`);

  const builtCss = compiler.build(Array.from(classes));
  console.log(`Generated CSS length: ${builtCss.length}`);
  fs.writeFileSync(path.join(__dirname, '../src/app/globals.css'), builtCss);
  console.log('Successfully wrote compiled Tailwind into src/app/globals.css');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
