import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import type { Animation } from './GenericFunctions';
import { incarnRequest, waitForAnimation } from './GenericFunctions';

export class Incarn implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Incarn',
		name: 'incarn',
		icon: { light: 'file:../../icons/incarn.svg', dark: 'file:../../icons/incarn.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Animate old family photos into short lifelike videos',
		defaults: { name: 'Incarn' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'incarnApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Animation', value: 'animation' },
					{ name: 'Account', value: 'account' },
				],
				default: 'animation',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['animation'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Animate a photo (uses 1 credit)',
						action: 'Animate a photo',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get the status and video of an animation',
						action: 'Get an animation',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get the account email and remaining credits',
						action: 'Get the account',
					},
				],
				default: 'get',
			},

			// Animation > Create
			{
				displayName: 'Photo Source',
				name: 'source',
				type: 'options',
				displayOptions: { show: { resource: ['animation'], operation: ['create'] } },
				options: [
					{
						name: 'Binary File',
						value: 'binary',
						description: 'A file from a previous node (JPG, PNG or WebP, up to 15 MB)',
					},
					{
						name: 'Image URL',
						value: 'url',
						description: 'A public link to the photo',
					},
				],
				default: 'binary',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: { resource: ['animation'], operation: ['create'], source: ['binary'] },
				},
				hint: 'The name of the input binary field containing the photo',
			},
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/grandma-1952.jpg',
				displayOptions: {
					show: { resource: ['animation'], operation: ['create'], source: ['url'] },
				},
			},
			{
				displayName: 'Motion Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				displayOptions: { show: { resource: ['animation'], operation: ['create'] } },
				description:
					'Optional. Describe the motion in English. Leave empty for the default gentle motion (blink, breath, slight smile).',
			},
			{
				displayName: 'Wait for Video',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['animation'], operation: ['create'] } },
				description:
					'Whether to wait until the video is ready (usually 1 to 3 minutes) before continuing',
			},

			// Animation > Get
			{
				displayName: 'Animation ID',
				name: 'animationId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['animation'], operation: ['get'] } },
				description: 'The ID returned when the animation was created',
			},

			// Commun aux deux opérations sur les animations
			{
				displayName: 'Download Video',
				name: 'downloadVideo',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['animation'] } },
				description:
					'Whether to add the MP4 to the output as a binary file when the video is ready',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['animation'] } },
				options: [
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						displayOptions: { show: { '/operation': ['create'] } },
						description:
							'A unique value per photo. Retrying with the same key never animates (or charges) twice.',
					},
					{
						displayName: 'Max Wait Time (Seconds)',
						name: 'maxWait',
						type: 'number',
						typeOptions: { minValue: 30, maxValue: 900 },
						default: 360,
						displayOptions: { show: { '/operation': ['create'] } },
						description:
							'How long to wait for the video. After that the node returns the animation still processing; use Get later.',
					},
					{
						displayName: 'Put Video in Field',
						name: 'binaryOutputField',
						type: 'string',
						default: 'video',
						description: 'Name of the output binary field for the MP4',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhookUrl',
						type: 'string',
						default: '',
						displayOptions: { show: { '/operation': ['create'] } },
						description:
							'Incarn calls this URL when the video is ready (for example an n8n Webhook node)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'account') {
					const account = await incarnRequest.call(this, 'GET', '/v1/account', undefined, {}, i);
					returnData.push({ json: account, pairedItem: { item: i } });
					continue;
				}

				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				let animation: Animation;

				if (operation === 'create') {
					animation = await createAnimation.call(this, i, options);
					if (this.getNodeParameter('waitForCompletion', i) as boolean) {
						animation = await waitForAnimation.call(
							this,
							animation,
							(options.maxWait as number | undefined) ?? 360,
							i,
						);
						if (animation.status === 'failed') {
							throw new NodeOperationError(
								this.getNode(),
								`The animation failed: ${animation.error ?? 'unknown error'}`,
								{ itemIndex: i },
							);
						}
					}
				} else {
					const id = this.getNodeParameter('animationId', i) as string;
					animation = (await incarnRequest.call(
						this,
						'GET',
						`/v1/animations/${encodeURIComponent(id.trim())}`,
						undefined,
						{},
						i,
					)) as Animation;
				}

				const item: INodeExecutionData = { json: animation, pairedItem: { item: i } };
				if (
					(this.getNodeParameter('downloadVideo', i) as boolean) &&
					animation.status === 'succeeded' &&
					animation.video_url
				) {
					// Lien public du CDN : pas d'en-tête d'authentification à envoyer.
					const video = (await this.helpers.httpRequest({
						method: 'GET',
						url: animation.video_url,
						encoding: 'arraybuffer',
					})) as ArrayBuffer;
					const field = ((options.binaryOutputField as string | undefined) || 'video').trim();
					item.binary = {
						[field]: await this.helpers.prepareBinaryData(
							Buffer.from(video),
							`incarn-${animation.id}.mp4`,
							'video/mp4',
						),
					};
				}
				returnData.push(item);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// Les deux constructeurs rendent telle quelle une erreur déjà du bon type.
				if (error instanceof NodeApiError)
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

async function createAnimation(
	this: IExecuteFunctions,
	i: number,
	options: IDataObject,
): Promise<Animation> {
	const source = this.getNodeParameter('source', i) as string;
	const prompt = (this.getNodeParameter('prompt', i, '') as string).trim();
	const webhookUrl = ((options.webhookUrl as string | undefined) ?? '').trim();
	const idempotencyKey = ((options.idempotencyKey as string | undefined) ?? '').trim();
	const headers: IDataObject = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};

	if (source === 'url') {
		const body: IDataObject = {
			image_url: (this.getNodeParameter('imageUrl', i) as string).trim(),
		};
		if (prompt) body.prompt = prompt;
		if (webhookUrl) body.webhook_url = webhookUrl;
		return (await incarnRequest.call(
			this,
			'POST',
			'/v1/animations',
			body,
			headers,
			i,
		)) as Animation;
	}

	const field = this.getNodeParameter('binaryPropertyName', i) as string;
	const binary = this.helpers.assertBinaryData(i, field);
	const buffer = await this.helpers.getBinaryDataBuffer(i, field);
	const form = new FormData();
	form.append(
		'image',
		new Blob([new Uint8Array(buffer)], { type: binary.mimeType }),
		binary.fileName ?? 'photo.jpg',
	);
	if (prompt) form.append('prompt', prompt);
	if (webhookUrl) form.append('webhook_url', webhookUrl);
	return (await incarnRequest.call(
		this,
		'POST',
		'/v1/animations',
		form as unknown as IHttpRequestOptions['body'],
		headers,
		i,
	)) as Animation;
}
