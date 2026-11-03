const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Faltan variables para el portal de soporte: ${missing.join(', ')}`);
  process.exit(1);
}

if (!process.env.VITE_SUPABASE_URL.startsWith('https://')) {
  console.error('VITE_SUPABASE_URL debe usar HTTPS.');
  process.exit(1);
}
