import { env } from 'cloudflare:workers';
import { handleProgress } from '../../../lib/progress-api.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleProgress(request, env); }
export async function PUT(request: Request) { return handleProgress(request, env); }
