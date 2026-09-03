import type { LayoutServerLoad } from "./$types";

/**
 * Hands the browser what the server already worked out, null included.
 *
 * Null is not signed out: it is a server reporting that it looked and could not place this
 * visitor, which is the ordinary case for an expired access token over a live refresh cookie.
 * Dropping it would put your signed-out screen in the HTML of every page.
 */
export const load: LayoutServerLoad = ({ locals }) => ({ session: locals.idenzy.session });
