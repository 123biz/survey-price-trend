// scripts/generate-icons.js
// Run: node scripts/generate-icons.js
// Requires: sharp (npm install --save-dev sharp)

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgBuffer = readFileSync(resolve(root, 'public', 'icon-source.svg'));

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function generate() {
  for (const size of sizes) {
    const outPath = resolve(root, 'public', 'icons', `icon-${size}x${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outPath);
    console.log(`✓ icon-${size}x${size}.png`);
  }

  // Apple touch icon (180x180)
  const applePath = resolve(root, 'public', 'icons', 'apple-touch-icon.png');
  await sharp(svgBuffer)
    .resize(180, 180)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(applePath);
  console.log('✓ apple-touch-icon.png (180x180)');

  console.log('\nAll icons generated successfully.');
}

generate().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
