const sharp = require('sharp');
const fs = require('fs');

const svg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="112" fill="#171717"/>
  <path d="M128 384L256 128L384 384" stroke="#10b981" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

async function generate() {
  await sharp(Buffer.from(svg))
    .resize(192, 192)
    .png()
    .toFile('public/pwa-192x192.png');
    
  await sharp(Buffer.from(svg))
    .resize(512, 512)
    .png()
    .toFile('public/pwa-512x512.png');
    
  await sharp(Buffer.from(svg))
    .resize(180, 180) // Standard iOS size
    .png()
    .toFile('public/apple-touch-icon.png');
    
  console.log('Icons generated successfully.');
}

generate().catch(console.error);
