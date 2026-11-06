import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {handleApi} from '../../../lib/accounting/online.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handleApi(request,env,await getChatGPTUser());}
export async function POST(request:Request){return handleApi(request,env,await getChatGPTUser());}
export async function DELETE(request:Request){return handleApi(request,env,await getChatGPTUser());}
export async function PUT(request:Request){return handleApi(request,env,await getChatGPTUser());}
