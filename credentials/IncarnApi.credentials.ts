import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class IncarnApi implements ICredentialType {
	name = 'incarnApi';

	displayName = 'Incarn API';

	icon: Icon = { light: 'file:../icons/incarn.svg', dark: 'file:../icons/incarn.dark.svg' };

	documentationUrl = 'https://www.incarn.co/en/developers/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Create a key on https://www.incarn.co/en/developers. It starts with ik_live_.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.incarn.co',
			url: '/v1/account',
		},
	};
}
