import {escapeHtml as e, origin} from './shared.mjs';
export function breadcrumb(page) {
  const items=[{name:'Home',path:'/'}];
  if(page.path.startsWith('/effects/')) items.push({name:'Effects',path:'/effects'});
  items.push({name:page.h1,path:page.path});
  return {
    html:`<nav class="seo-breadcrumbs" aria-label="Breadcrumb"><ol>${items.map((item,i)=>`<li>${i===items.length-1?`<span aria-current="page">${e(item.name)}</span>`:`<a href="${item.path}">${e(item.name)}</a>`}</li>`).join('')}</ol></nav>`,
    schema:{'@type':'BreadcrumbList',itemListElement:items.map((item,i)=>({'@type':'ListItem',position:i+1,name:item.name,item:origin+item.path}))},
  };
}
export function socialImage(html, slug, label) {
  const image=origin+`/og/${slug}.png`;
  for(const [attribute,key,value] of [
    ['property','og:image',image],['property','og:image:width','1200'],['property','og:image:height','630'],['property','og:image:type','image/png'],['property','og:image:alt',label],
    ['name','twitter:card','summary_large_image'],['name','twitter:image',image],['name','twitter:image:alt',label],
  ]) {
    const pattern=new RegExp(`<meta\\b(?=[^>]*${attribute}=["']${key}["'])[^>]*>`,'i');
    const tag=`<meta ${attribute}="${key}" content="${e(value)}">`;
    html=pattern.test(html)?html.replace(pattern,tag):html.replace('</head>',tag+'</head>');
  }
  return html;
}
export function linkHomeTools(html) {
  const links='<div class="seo-home-links"><a href="/text-animation-generator">Explore the text animation generator →</a><a href="/animated-title-generator">Create animated titles and intros →</a></div>';
  if(!html.includes('class="seo-home-links"')) html=html.replace(/(<section\b[^>]*id="how"[^>]*>[\s\S]*?<\/section>)/,`$1${links}`);
  if(!html.includes('href="/seo.css"')) html=html.replace('</head>','<link rel="stylesheet" href="/seo.css"></head>');
  return html;
}
export function linkLibraryTool(html) {
  return html.replace(/(<h1\b[^>]*>[\s\S]*?<\/h1>)/,'$1<p class="seo-library-link">Make your own words move with the <a href="/text-animation-generator">text animation generator</a>.</p>').replace('</head>','<link rel="stylesheet" href="/seo.css"></head>');
}
