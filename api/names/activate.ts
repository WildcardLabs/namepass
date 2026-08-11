import { handler, json, readObject, requiredString } from "../../server/http";
import { activateName } from "../../server/names";

export default handler("POST", async (request) => {
	const body = await readObject(request, ["name"]);
	const activation = await activateName(requiredString(body, "name", 512));
	return json(activation, activation.activated ? 201 : 200);
});
