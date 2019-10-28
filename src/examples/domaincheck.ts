import { ApiClient, Language } from '../domrobot';

const username = '';
const password = '';
const sharedSecret = ''; // only needed for 2FA.
const domain = 'my-test-domain-' + Math.round(Math.random() * 1e8) + '.com'; // the domain which will be checked.

const asyncFunc = async () => {
    // By default you ApiClient uses the test api (OT&E). If you want to use the production/live api
    // we have a constant named API_LIVE_URL in the ApiClient class. Just set api_url=ApiClient.API_URL_LIVE and you're good.
    const apiClient = new ApiClient(ApiClient.API_URL_OTE, Language.EN, true);

    const loginResponse = await apiClient.login(username, password, sharedSecret);
    if (loginResponse.code !== 1000) {
        throw new Error(`Api login error. Code: ${loginResponse.code}  Message: ${loginResponse.msg}`);
    }

    // Make an api call and save the result in a variable.
    // We want to check if a domain is available, so we call the api method 'domain.check'.
    const domainCheckResponse = await apiClient.callApi('domain.check', { domain });
    if (domainCheckResponse.code !== 1000) {
        throw new Error(`Api error while checking domain status. Code: 
                            ${domainCheckResponse.code}  Message: ${domainCheckResponse.msg}`);
    }

    // get the first domain in the result array 'domain'
    const checkedDomain = domainCheckResponse.resData.domain[0];
    if (checkedDomain.avail) {
        console.log(`${domain} is still available!`);
    } else {
        console.log(`Unfortunately, ${domain} is already registered.`);
    }
};

// call the async function
asyncFunc();
