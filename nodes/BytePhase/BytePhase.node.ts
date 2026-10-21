import type {
	FieldType,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ResourceMapperField,
	ResourceMapperFields,
	ResourceMapperValue,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface BytePhaseCredentials {
	baseUrl: string;
	apiKey: string;
}

function buildHeaders(): IDataObject {
	return {
		Accept: 'application/json',
		'Content-Type': 'application/json',
	};
}

/** The API is served per workspace, so the host already identifies it; the key does the rest. */
function apiUrl(credentials: BytePhaseCredentials, path: string): string {
	return `${credentials.baseUrl.replace(/\/+$/, '')}${path}`;
}

interface BytePhaseErrorBody {
	error?: { code?: string; message?: string; request_id?: string; details?: unknown[] };
	message?: string;
}

/**
 * Errors carry a stable code, a readable message and a request id. Surfacing them beats
 * "Request failed with status code 404", and the request id is what support asks for.
 */
function describeApiError(error: unknown): { message: string; description?: string } | undefined {
	const response = (error as { response?: { body?: unknown; data?: unknown } }).response;
	const body = (response?.body ?? response?.data ?? (error as { error?: unknown }).error) as
		| BytePhaseErrorBody
		| undefined;

	const detail = body?.error;
	const message = detail?.message ?? body?.message;
	if (!message) return undefined;

	const parts: string[] = [];
	if (detail?.code) parts.push(`Code: ${detail.code}`);
	if (detail?.request_id) parts.push(`Request ID: ${detail.request_id}`);

	return { message, description: parts.length > 0 ? parts.join(' · ') : undefined };
}

/**
 * Custom fields are defined once, in BytePhase, per form type. The node reads those
 * definitions rather than asking the workflow author to retype field names, so renaming a
 * field in BytePhase does not silently break a workflow.
 */
const CUSTOM_FIELD_FORM_TYPES: Record<string, string> = {
	lead: 'Lead',
	selfCheckin: 'Self check-in',
};

interface BytePhaseCustomField {
	field_name?: string;
	field_type?: string;
	placeholder?: string | null;
	is_field_required?: boolean;
	select_box_items?: string[];
}

/** BytePhase's three field types, mapped onto the controls n8n knows how to render. */
function mapFieldType(fieldType: string | undefined): FieldType {
	switch (fieldType) {
		case 'Dropdown':
			return 'options';
		case 'Number':
			return 'number';
		default:
			return 'string';
	}
}

function toResourceMapperField(field: BytePhaseCustomField): ResourceMapperField | undefined {
	const name = (field.field_name ?? '').trim();
	if (name === '') return undefined;

	const type = mapFieldType(field.field_type);
	const options: INodePropertyOptions[] = (field.select_box_items ?? [])
		.filter((item) => typeof item === 'string' && item.trim() !== '')
		.map((item) => ({ name: item, value: item }));

	// A dropdown whose list is empty would render as an unusable picker.
	const usableType: FieldType = type === 'options' && options.length === 0 ? 'string' : type;

	return {
		id: name,
		displayName: name,
		required: field.is_field_required === true,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		type: usableType,
		...(usableType === 'options' ? { options } : {}),
	};
}

export class BytePhase implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'BytePhase',
		name: 'bytePhase',
		icon: 'file:bytephase.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send leads and device self check-ins to BytePhase repair shop software',
		defaults: {
			name: 'BytePhase',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'bytePhaseApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Lead',
						value: 'lead',
						description: 'A sales/repair enquiry in BytePhase',
					},
					{
						name: 'Self Check-In',
						value: 'selfCheckin',
						description: 'A customer device check-in request in BytePhase',
					},
				],
				default: 'lead',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['lead'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a lead in BytePhase',
						action: 'Create a lead',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['selfCheckin'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a device self check-in in BytePhase',
						action: 'Create a self check in',
					},
				],
				default: 'create',
			},

			// ----------------------------------
			//         Shared required fields
			// ----------------------------------
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				required: true,
				default: '',
				description: 'Customer name',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description: 'Customer email. At least one of Email or Mobile Number is required.',
			},
			{
				displayName: 'Mobile Number',
				name: 'mobileNumber',
				type: 'string',
				default: '',
				description: 'Customer mobile number. At least one of Email or Mobile Number is required.',
			},

			// ----------------------------------
			//         lead: additional fields
			// ----------------------------------
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['lead'],
					},
				},
				options: [
					{
						displayName: 'Address Line',
						name: 'addressLine',
						type: 'string',
						default: '',
					},
					{
						displayName: 'City',
						name: 'city',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Comment',
						name: 'comment',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						description: 'Free-text note, e.g. the reported problem',
					},
					{
						displayName: 'Contact Person Name',
						name: 'contactPersonName',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Device Brand',
						name: 'deviceBrand',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Device Model',
						name: 'deviceModel',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Device Type',
						name: 'deviceType',
						type: 'string',
						default: '',
						description: 'E.g. Mobile, Laptop — matched to your BytePhase device types by name.',
					},
					{
						displayName: 'Mobile Country Code',
						name: 'mobileCountryCode',
						type: 'string',
						default: '',
						placeholder: '+91',
					},
					{
						displayName: 'Next Follow-Up',
						name: 'nextFollowUp',
						type: 'dateTime',
						default: '',
					},
					{
						displayName: 'Phone Number',
						name: 'phoneNumber',
						type: 'string',
						default: '',
						description: 'Secondary/landline number',
					},
					{
						displayName: 'Source',
						name: 'source',
						type: 'string',
						default: '',
						description: 'Lead source name as configured in BytePhase, e.g. Website',
					},
					{
						displayName: 'State',
						name: 'state',
						type: 'string',
						default: '',
					},
					{
						displayName: 'ZIP Code',
						name: 'zipCode',
						type: 'string',
						default: '',
					},
				],
			},

			// ----------------------------------
			//    selfCheckin: additional fields
			// ----------------------------------
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['selfCheckin'],
					},
				},
				options: [
					{
						displayName: 'Accessories',
						name: 'accessories',
						type: 'string',
						default: '',
						description: 'Comma-separated list of accessories handed in, e.g. "Charger, Cover"',
					},
					{
						displayName: 'Address Line',
						name: 'addressLine',
						type: 'string',
						default: '',
					},
					{
						displayName: 'City',
						name: 'city',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Comment',
						name: 'comment',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						description: 'Free-text note, e.g. the reported problem',
					},
					{
						displayName: 'Device Brand',
						name: 'deviceBrand',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Device Model',
						name: 'deviceModel',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Device Password',
						name: 'devicePassword',
						type: 'string',
						typeOptions: { password: true },
						default: '',
					},
					{
						displayName: 'Device Type',
						name: 'deviceType',
						type: 'string',
						default: '',
						description: 'E.g. Mobile, Laptop — matched to your BytePhase device types by name.',
					},
					{
						displayName: 'Is Data Recovery',
						name: 'isRecovery',
						type: 'boolean',
						default: false,
						description: 'Whether this check-in is a data recovery job',
					},
					{
						displayName: 'Is Pickup Booked',
						name: 'isPickupBooked',
						type: 'boolean',
						default: false,
						description: 'Whether a device pickup has been booked',
					},
					{
						displayName: 'Mobile Country Code',
						name: 'mobileCountryCode',
						type: 'string',
						default: '',
						placeholder: '+91',
					},
					{
						displayName: 'Scheduled On',
						name: 'scheduledOn',
						type: 'dateTime',
						default: '',
						description: 'When the customer plans to drop off the device',
					},
					{
						displayName: 'Serial Number',
						name: 'serialNumber',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Serial Number 2',
						name: 'serialNumber2',
						type: 'string',
						default: '',
						description: 'Second serial/IMEI number',
					},
					{
						displayName: 'State',
						name: 'state',
						type: 'string',
						default: '',
					},
					{
						displayName: 'ZIP Code',
						name: 'zipCode',
						type: 'string',
						default: '',
					},
				],
			},

			// ----------------------------------
			//         Custom fields (both)
			// ----------------------------------
			{
				displayName: 'Custom Fields',
				name: 'customFields',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				description:
					'The custom fields your shop has defined in BytePhase for this record type. Dropdown fields offer the same choices as the app.',
				typeOptions: {
					loadOptionsDependsOn: ['resource'],
					resourceMapper: {
						resourceMapperMethod: 'getCustomFields',
						mode: 'add',
						fieldWords: { singular: 'custom field', plural: 'custom fields' },
						addAllFields: false,
						multiKeyMatch: false,
						supportAutoMap: true,
						noFieldsError:
							'No custom fields are defined for this record type in BytePhase. Add them under Settings → Custom Fields, then reload.',
					},
				},
			},

			// ----------------------------------
			//              Options
			// ----------------------------------
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Form ID',
						name: 'formId',
						type: 'string',
						default: '',
						description:
							'Labels this workflow on the BytePhase Activity screen. Give each workflow its own value to tell them apart.',
					},
					{
						displayName: 'Business ID',
						name: 'businessId',
						type: 'string',
						default: '',
						description:
							'Which business (branch) the record belongs to. Leave empty to use the workspace default.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description:
							'Unique key to make the request safe to retry — a replay with the same key returns the original result instead of creating a duplicate',
					},
				],
			},
		],
	};

	methods = {
		resourceMapping: {
			async getCustomFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const credentials = (await this.getCredentials(
					'bytePhaseApi',
				)) as unknown as BytePhaseCredentials;
				const resource = this.getNodeParameter('resource', 0) as string;
				const formType = CUSTOM_FIELD_FORM_TYPES[resource] ?? CUSTOM_FIELD_FORM_TYPES.lead;

				const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'bytePhaseApi', {
					method: 'GET',
					url: apiUrl(credentials, '/integrations/custom-fields'),
					qs: { form_type: formType },
					headers: buildHeaders(),
					json: true,
				})) as { fields?: BytePhaseCustomField[] };

				const fields = (response?.fields ?? [])
					.map(toResourceMapperField)
					.filter((field): field is ResourceMapperField => field !== undefined);

				return {
					fields,
					emptyFieldsNotice: `No custom fields are defined for "${formType}" in BytePhase. Add them under Settings → Custom Fields, then reload this list.`,
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = (await this.getCredentials('bytePhaseApi')) as unknown as BytePhaseCredentials;
		const resource = this.getNodeParameter('resource', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const name = this.getNodeParameter('name', i) as string;
				const email = this.getNodeParameter('email', i, '') as string;
				const mobileNumber = this.getNodeParameter('mobileNumber', i, '') as string;
				const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const customFieldsMapper = this.getNodeParameter(
					'customFields',
					i,
					{},
				) as Partial<ResourceMapperValue>;

				if (!email && !mobileNumber) {
					throw new NodeOperationError(
						this.getNode(),
						'Either Email or Mobile Number must be set.',
						{ itemIndex: i },
					);
				}

				const data: IDataObject = { name };
				if (email) data.email = email;
				if (mobileNumber) data.mobile_number = mobileNumber;

				const stringField = (uiKey: string, apiKey: string) => {
					const value = additionalFields[uiKey];
					if (value !== undefined && value !== '') data[apiKey] = value;
				};

				stringField('mobileCountryCode', 'mobile_country_code');
				stringField('comment', 'comment');
				stringField('deviceType', 'device_type');
				stringField('deviceBrand', 'device_brand');
				stringField('deviceModel', 'device_model');

				if (resource === 'lead') {
					stringField('phoneNumber', 'phone_number');
					stringField('contactPersonName', 'contact_person_name');
					stringField('source', 'source');
					stringField('nextFollowUp', 'next_follow_up');
				} else {
					stringField('serialNumber', 'serial_number');
					stringField('serialNumber2', 'serial_number_2');
					stringField('devicePassword', 'device_password');
					stringField('scheduledOn', 'scheduled_on');
					if (additionalFields.accessories !== undefined && additionalFields.accessories !== '') {
						data.accessories = (additionalFields.accessories as string)
							.split(',')
							.map((entry) => entry.trim())
							.filter((entry) => entry !== '');
					}
					if (additionalFields.isRecovery === true) data.is_recovery = true;
					if (additionalFields.isPickupBooked === true) data.is_pickup_booked = true;
				}

				const address: IDataObject = {};
				if (additionalFields.addressLine) address.address_line = additionalFields.addressLine;
				if (additionalFields.city) address.city = additionalFields.city;
				if (additionalFields.state) address.state = additionalFields.state;
				if (additionalFields.zipCode) address.zip_code = additionalFields.zipCode;
				if (Object.keys(address).length > 0) data.address = address;

				// "Map Each Field Below" fills `value`; "Map Automatically" leaves it null and
				// expects the incoming item's own keys to be matched against the schema.
				const mappedCustomFields: IDataObject =
					customFieldsMapper.mappingMode === 'autoMapInputData'
						? Object.fromEntries(
								(customFieldsMapper.schema ?? [])
									.map((field) => field.id)
									.filter((id) => id in (items[i].json ?? {}))
									.map((id) => [id, (items[i].json as IDataObject)[id]]),
							)
						: ((customFieldsMapper.value ?? {}) as IDataObject);

				const customFields: IDataObject = {};
				for (const [key, value] of Object.entries(mappedCustomFields)) {
					if (value !== null && value !== undefined && value !== '') {
						customFields[key] = value as string | number | boolean;
					}
				}
				if (Object.keys(customFields).length > 0) {
					data.custom_fields = customFields;
				}

				const body: IDataObject = {
					destination: resource === 'lead' ? 'lead' : 'self_checkin',
					data,
				};
				if (options.formId) body.form_id = options.formId;
				if (options.businessId) body.business_id = Number(options.businessId);

				const headers = buildHeaders();
				if (options.idempotencyKey) {
					headers['Idempotency-Key'] = options.idempotencyKey;
				}

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: apiUrl(credentials, '/integrations/submit'),
					headers,
					body,
					json: true,
				};

				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'bytePhaseApi',
					requestOptions,
				)) as IDataObject;

				returnData.push({
					json: response ?? { status: 'received' },
					pairedItem: { item: i },
				});
			} catch (error) {
				const described = describeApiError(error);

				if (this.continueOnFail()) {
					returnData.push({
						json: { error: described?.message ?? (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as never, {
					itemIndex: i,
					...(described?.message ? { message: described.message } : {}),
					...(described?.description ? { description: described.description } : {}),
				});
			}
		}

		return [returnData];
	}
}
