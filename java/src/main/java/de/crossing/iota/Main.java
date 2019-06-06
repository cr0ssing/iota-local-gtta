package de.crossing.iota;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.zeromq.ZMQ;

/**
 * @author crossing
 *
 */
public class Main {
	private ZMQ.Socket requester;
	private Logger log = LoggerFactory.getLogger(Main.class);

	public static void main(String[] args) throws IOException {
		Main m = new Main();
		m.init();
	}

	public void init() throws IOException {
		ZMQ.Context context = ZMQ.context(1);
		this.requester = context.socket(ZMQ.SUB);
		this.requester.connect("tcp://zmq.devnet.iota.org:5556");
		this.requester.subscribe("tx");
		this.requester.subscribe("sn");
		log.info("Connected to ZMQ stream.");
		
		TangleListener tangle = new TangleListener(requester, 5);
		new Thread(tangle, "ZMQListener").start();
		TipSelection t = new TipSelection(tangle, .001d);
		new Server(t);
	}
}
