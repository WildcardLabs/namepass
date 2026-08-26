export async function recordWorkflowFailureStep(flowId: string, text: string) {
	"use step";
	return (await import("../server/workflow-failures")).recordWorkflowFailure(flowId, text);
}
