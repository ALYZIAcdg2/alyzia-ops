// Fabrique la page finale au déploiement.
// Jusqu'ici, à CHAQUE ouverture, le Worker relisait les 5 Mo de public/index.html et les faisait passer dans ~40 "wrappers" qui
// la modifient (1,5 à 2,5 s de calcul). Le résultat est identique pour tout le monde (vérifié : même empreinte quelle que soit l'URL,
// le navigateur ou les cookies, et le seul accès à env est ASSETS). On le calcule donc une seule fois ici et le Worker sert le fichier tel quel.
// Sortie : public/baked-index (sans extension pour éviter la redirection .html du service d'assets).
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const worker=(await import("../src/ui-first-paint-wrapper.js")).default;
const source=readFileSync(new URL("../public/index.html",import.meta.url));
const env={
  ASSETS:{fetch:async()=>new Response(source,{headers:{"content-type":"text/html; charset=UTF-8"}})},
  OPS_DB:{prepare(){return {bind(){return this},async all(){return {results:[]}},async first(){return null},async run(){return {}}}},batch:async()=>[]}
};
globalThis.__ALYZIA_BAKING=true;
const res=await worker.fetch(new Request("https://bake.invalid/?bake=1"),env,{waitUntil(){}});
const html=await res.text();
if(res.status!==200||!/text\/html/i.test(res.headers.get("content-type")||"")||html.length<source.length*0.9||!html.includes("alyzia-first-paint-guard-css"))
  throw new Error(`Fabrication invalide : statut ${res.status}, ${html.length} octets (source ${source.length})`);
writeFileSync(new URL("../public/baked-index",import.meta.url),html);
writeFileSync(new URL("../public/baked-version",import.meta.url),createHash("sha1").update(html).digest("hex").slice(0,16)+" "+Math.floor(Date.now()/1000));
console.log(`page fabriquée : ${html.length} octets (source ${source.length}), empreinte ${createHash("sha1").update(html).digest("hex").slice(0,12)}`);
