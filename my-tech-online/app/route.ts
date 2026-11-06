import shell from '../lib/shell.mjs';
export function GET(){return new Response(shell,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});}
