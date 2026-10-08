// Applies GAME_TITLE (from www/js/config.js) to the Android app name and capacitor.config.json.
// Run before `npx cap sync android` (CI does this automatically).
import fs from 'node:fs';

const config_source = fs.readFileSync('www/js/config.js', 'utf8');
const title_match = config_source.match(/GAME_TITLE\s*=\s*'([^']+)'/);
if (!title_match) throw new Error('GAME_TITLE not found in www/js/config.js');
const game_title = title_match[1];
const xml_title = game_title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, "\\'");

const capacitor_config = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
capacitor_config.appName = game_title;
fs.writeFileSync('capacitor.config.json', JSON.stringify(capacitor_config, null, 2) + '\n');

const strings_path = 'android/app/src/main/res/values/strings.xml';
let strings_xml = fs.readFileSync(strings_path, 'utf8');
strings_xml = strings_xml
  .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${xml_title}</string>`)
  .replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${xml_title}</string>`);
fs.writeFileSync(strings_path, strings_xml);

const index_path = 'www/index.html';
const index_html = fs.readFileSync(index_path, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${xml_title}</title>`);
fs.writeFileSync(index_path, index_html);
console.log(`Branding applied: "${game_title}"`);
