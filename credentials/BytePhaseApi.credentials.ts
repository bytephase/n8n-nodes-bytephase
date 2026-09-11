import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BytePhaseApi implements ICredentialType {
	name = 'bytePhaseApi';

	displayName = 'BytePhase API';

	documentationUrl = 'https://developers.bytephase.com';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://{workspace}.api.bytephase.com/api',
			placeholder: 'https://harbor-repair.api.bytephase.com/api',
			required: true,
			description:
				'The API address of your workspace. Replace {workspace} with your workspace subdomain — the part before .bytephase.com in the address you open BytePhase at. Note the api. in the middle: the sign-in address serves the web app, not the API. A white-label workspace on its own domain uses https://your-domain.com/api.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'bp_...',
			required: true,
			description:
				'Create an n8n integration in BytePhase under Settings → Integrations and copy the key. It starts with bp_ and is shown once.',
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

	// Confirms the key, the host and the workspace in one request, and creates nothing.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/integrations/ping',
		},
	};
}
