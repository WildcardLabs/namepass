import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
	Card,
	CardHeader,
	CardTitle,
	CardContent,
	CardDescription,
} from "../ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../ui/table";

type Partner = { id: string; name: string; enabled: boolean };
type Key = {
	id: string;
	partnerId: string;
	prefix: string;
	revokedAt: string | null;
	scopes: string[];
};
type Job = {
	id: string;
	kind: string;
	status: string;
	attempts: number;
	reasonCode: string | null;
};
type Delivery = {
	id: string;
	endpointId: string;
	status: string;
	attempts: number;
	reasonCode: string | null;
};
type Data = {
	partners: Partner[];
	keys: Key[];
	jobs: Job[];
	deliveries: Delivery[];
	metrics: Record<string, number | string | null>;
};
const scopes = [
	"read",
	"names:write",
	"transfers:write",
	"flows:retry",
	"webhooks:manage",
];
export default function IntegrationsAdmin() {
	const [data, setData] = useState<Data | null>(null),
		[name, setName] = useState(""),
		[error, setError] = useState(""),
		[busy, setBusy] = useState(false),
		[credential, setCredential] = useState("");
	const [selectedScopes, setSelectedScopes] = useState<string[]>(["read"]);
	async function load() {
		const r = await fetch("/api/monitoring/integrations", {
			credentials: "same-origin",
		});
		const b = await r.json();
		if (!r.ok)
			throw new Error(b.error?.message ?? "Unable to load integrations.");
		setData(b);
	}
	useEffect(() => {
		void load().catch((e) => setError(String(e.message)));
	}, []);
	async function act(body: Record<string, unknown>) {
		setBusy(true);
		setError("");
		setCredential("");
		try {
			const r = await fetch("/api/monitoring/integrations", {
				method: "POST",
				credentials: "same-origin",
				headers: {
					"content-type": "application/json",
					"x-namepass-admin": "1",
				},
				body: JSON.stringify(body),
			});
			const b = await r.json();
			if (!r.ok) throw new Error(b.error?.message ?? "The action failed.");
			if (b.apiKey) setCredential(b.apiKey);
			await load();
		} catch (e) {
			setError(e instanceof Error ? e.message : "The action failed.");
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="space-y-5">
			<Card>
				<CardHeader>
					<CardTitle>Integrations</CardTitle>
					<CardDescription>
						Provision partner credentials and inspect durable delivery and
						verification work.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{error && (
						<p role="alert" className="text-red-700">
							{error}
						</p>
					)}
					{credential && (
						<div role="status" className="rounded border p-4">
							<p>Copy this API key now. It will not be shown again.</p>
							<code className="break-all">{credential}</code>
							<Button variant="outline" onClick={() => setCredential("")}>
								Dismiss
							</Button>
						</div>
					)}
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							void act({ action: "create_partner", name });
						}}
					>
						<Input
							aria-label="Partner name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={120}
							required
							placeholder="Partner name"
						/>
						<Button disabled={busy || !name.trim()}>Create partner</Button>
					</form>
					<fieldset className="flex flex-wrap gap-4">
						<legend className="mb-2 text-sm">Scopes for new keys</legend>
						{scopes.map((scope) => (
							<label key={scope} className="flex gap-2 text-xs">
								<input
									type="checkbox"
									checked={selectedScopes.includes(scope)}
									onChange={(e) =>
										setSelectedScopes((current) =>
											e.target.checked
												? [...current, scope]
												: current.filter((s) => s !== scope),
										)
									}
								/>
								{scope}
							</label>
						))}
					</fieldset>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Partner</TableHead>
								<TableHead>State</TableHead>
								<TableHead>Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.partners.map((p) => (
								<TableRow key={p.id}>
									<TableCell>{p.name}</TableCell>
									<TableCell>{p.enabled ? "Enabled" : "Disabled"}</TableCell>
									<TableCell className="space-x-2">
										<Button
											variant="outline"
											size="sm"
											disabled={busy || !selectedScopes.length}
											onClick={() =>
												void act({
													action: "create_key",
													partnerId: p.id,
													scopes: selectedScopes,
												})
											}
										>
											Issue key
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={busy}
											onClick={() =>
												void act({
													action: "set_partner_enabled",
													partnerId: p.id,
													enabled: !p.enabled,
												})
											}
										>
											{p.enabled ? "Disable" : "Enable"}
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Key prefix</TableHead>
								<TableHead>Scopes</TableHead>
								<TableHead>State</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.keys.map((k) => (
								<TableRow key={k.id}>
									<TableCell>
										<code>{k.prefix}</code>
									</TableCell>
									<TableCell>{k.scopes.join(", ")}</TableCell>
									<TableCell>
										{k.revokedAt ? (
											"Revoked"
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={busy}
												onClick={() =>
													void act({ action: "revoke_key", keyId: k.id })
												}
											>
												Revoke
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Recovery and delivery</CardTitle>
					<CardDescription>
						Verification can remain pending when canonical receipt evidence is
						unavailable. A retry does not send customer funds.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => void load().catch((e) => setError(e.message))}
					>
						Refresh stored state
					</Button>
					<dl className="grid gap-2 md:grid-cols-3">
						{Object.entries(data?.metrics ?? {}).map(([key, value]) => (
							<div key={key}>
								<dt className="text-xs text-muted-foreground">{key}</dt>
								<dd className="font-mono text-sm">{String(value ?? "—")}</dd>
							</div>
						))}
					</dl>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Work</TableHead>
								<TableHead>State</TableHead>
								<TableHead>Reason</TableHead>
								<TableHead>Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.jobs.map((j) => (
								<TableRow key={j.id}>
									<TableCell>{j.kind}</TableCell>
									<TableCell>
										{j.status} ({j.attempts})
									</TableCell>
									<TableCell>{j.reasonCode ?? "—"}</TableCell>
									<TableCell>
										<Button
											size="sm"
											variant="outline"
											disabled={busy || j.status === "running"}
											onClick={() =>
												void act({ action: "retry_job", jobId: j.id })
											}
										>
											Retry verification
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Delivery</TableHead>
								<TableHead>State</TableHead>
								<TableHead>Attempts</TableHead>
								<TableHead>Reason</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.deliveries.map((d) => (
								<TableRow key={d.id}>
									<TableCell className="font-mono text-xs">{d.id}</TableCell>
									<TableCell>{d.status}</TableCell>
									<TableCell>{d.attempts}</TableCell>
									<TableCell>{d.reasonCode ?? "—"}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
