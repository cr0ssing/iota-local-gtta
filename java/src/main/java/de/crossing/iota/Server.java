package de.crossing.iota;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * @author soowe
 *
 */
public class Server extends NanoHTTPD {
	private TipSelection ts;

	public Server(TipSelection ts) throws IOException {
		super(8080);
		start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
		this.ts = ts;
	}

	@Override
	public Response serve(IHTTPSession session) {
		Map<String, String> parms = session.getParms();
		if (parms.get("depth") == null) {
			return newFixedLengthResponse(Response.Status.BAD_REQUEST, "plain/text", "Depth not set");
		} else {
			int depth = Integer.parseInt(parms.get("depth"));
			try {
				List<String> tips = ts.getTips(depth);
				return newFixedLengthResponse(Response.Status.OK, "application/json",
						"{\n  \"trunk\": \"" + tips.get(0) + "\",\n  \"branch\": \"" + tips.get(1) + "\"\n}");
			} catch (Exception e) {
				return newFixedLengthResponse(Response.Status.BAD_REQUEST, "plain/text", e.getMessage());
			}
		}
	}
}