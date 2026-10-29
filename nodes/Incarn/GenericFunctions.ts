import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const BASE_URL = 'https://api.incarn.co';

export interface Animation extends IDataObject {
	id: string;
	status: 'processing' | 'succeeded' | 'failed';
	video_url: string | null;
	error: string | null;
	created_at: string;
}

// Messages lisibles pour les réponses d'erreur prévues par l'API.
const MESSAGES: Record<string, string> = {
	'401': 'Invalid API key. Check the key in your Incarn credential (it starts with ik_live_).',
	'402':
		'No credits left on your Incarn account. Buy credits on https://www.incarn.co/en/developers.',
	'429': 'Too many animations running at once on your Incarn account. Try again in a minute.',
};

export async function incarnRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IHttpRequestOptions['body'],
	headers: IDataObject = {},
	itemIndex = 0,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		headers: { Accept: 'application/json', ...headers },
		json: true,
	};
	if (body !== undefined) options.body = body;
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'incarnApi',
			options,
		)) as IDataObject;
	} catch (error) {
		const code = String(
			(error as { httpCode?: string }).httpCode ??
				(error as { response?: { status?: number } }).response?.status ??
				'',
		);
		// n8n renvoie déjà une NodeApiError, que le constructeur ci-dessous rend
		// telle quelle (options ignorées) : on remplace donc son message avant.
		if (error instanceof NodeApiError && MESSAGES[code]) error.message = MESSAGES[code];
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			itemIndex,
			message: MESSAGES[code],
		});
	}
}

/** Interroge l'animation jusqu'à la fin du traitement ou jusqu'au délai maximum. */
export async function waitForAnimation(
	this: IExecuteFunctions,
	animation: Animation,
	maxWaitSeconds: number,
	itemIndex: number,
	pollSeconds = 10,
): Promise<Animation> {
	let current = animation;
	const deadline = Date.now() + maxWaitSeconds * 1000;
	while (current.status === 'processing' && Date.now() < deadline) {
		await sleep(pollSeconds * 1000);
		current = (await incarnRequest.call(
			this,
			'GET',
			`/v1/animations/${encodeURIComponent(current.id)}`,
			undefined,
			{},
			itemIndex,
		)) as Animation;
	}
	return current;
}
