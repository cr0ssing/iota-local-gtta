package de.crossing.iota;

import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentSkipListSet;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import java.util.stream.Stream;

import org.iota.jota.IotaAPI;
import org.iota.jota.dto.response.GetNodeInfoResponse;
import org.iota.jota.utils.Checksum;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.zeromq.ZMQ;

public class TangleListener implements Runnable {
	private final static String DUMMY_ADDRESS = Checksum
			.addChecksum("999999999999999999999999999999999999999999999999999999999999999999999999999999999");

	private ZMQ.Socket requester;
	private final int maxDepth;

	private Map<String, Info> txs = new ConcurrentHashMap<>();
	private Map<Integer, Set<Info>> milestones = new ConcurrentHashMap<Integer, Set<Info>>();
	private Map<String, Info> tails = new ConcurrentHashMap<>();
	private Set<String> consistent = new ConcurrentSkipListSet<>();

	private int latestMilestone;
	private int availableDepth = -1;

	private final AtomicBoolean listening = new AtomicBoolean(true);
	private IotaAPI api;
	private final ReentrantLock lock = new ReentrantLock();

	private Logger log = LoggerFactory.getLogger(TangleListener.class);

	public TangleListener(ZMQ.Socket requester, int maxDepth) {
		this.requester = requester;
		this.maxDepth = maxDepth;
		this.api = new IotaAPI.Builder().protocol("https").host("nodes.devnet.iota.org").port(443).build();
	}

	public void run() {
		GetNodeInfoResponse response = api.getNodeInfo();
		log.info("{}", response);
		
		while (listening.get()) {
			try {
				byte[] reply = requester.recv(0);
				String[] arr = new String(reply).split(" ");

				switch (arr[0]) {
				case "tx":
					String hash = arr[1].trim();
					String trunk = arr[9].trim();
					String branch = arr[10].trim();
					String bundle = arr[8].trim();
					Info info = new Info(hash, bundle, txs.get(trunk), txs.get(branch));
					txs.put(hash, info);
					if (arr[6].trim().equals("0")) {
						tails.put(bundle, info);
					}

					addApprover(info);
					break;
				case "sn":
					int milestone = Integer.parseInt(arr[1]);
					if (latestMilestone != milestone) {
						log.info("New milestone: {}", milestone);
						latestMilestone = milestone;
						removeOldApprovers();
						milestones.put(milestone, new ConcurrentSkipListSet<>());
					}
					latestMilestone = milestone;
					Info tx = txs.get(arr[2].trim());
					if (tx != null) {
						Set<Info> confirmed = milestones.get(milestone);
						if (confirmed != null) {
							confirmed.add(tx);
							if (milestones.size() - 1 > availableDepth) {
								availableDepth++;
								log.info("Depth {} is available.", availableDepth);
							}
						}
					}
					break;
				}
			} catch (Exception e) {
				log.error("Reading zmq stream failed", e);
			}
		}
	}

	public boolean areTxsConsistent(String... txs) {
		try {
			String[] toCheck = Stream.of(txs).filter((t) -> !consistent.contains(t))
					.toArray(length -> new String[length]);
			if (toCheck.length > 0) {
				api.getBalances(50, new String[] { DUMMY_ADDRESS }, toCheck);
				Stream.of(toCheck).forEach((t) -> consistent.add(t));
			}
			return true;
		} catch (Exception e) {
			return false;
		}
	}

	public Map<Integer, Set<Info>> getMilestones() {
		return milestones;
	}

	public Map<String, Info> getTails() {
		return tails;
	}

	public int getLatestMilestone() {
		return latestMilestone;
	}

	public int getAvailableDepth() {
		return availableDepth;
	}

	public ReentrantLock getLock() {
		return lock;
	}

	private void addApprover(Info approver) {
		lock.lock();
		Consumer<Info> add = info -> info.getDirectApprovers().add(approver);
		Optional.ofNullable(approver.getTrunk()).ifPresent(add);
		Optional.ofNullable(approver.getBranch()).ifPresent(add);
		Set<Info> visited = new HashSet<>();
		updateRecursivly(approver.getTrunk(), visited);
		updateRecursivly(approver.getBranch(), visited);
		lock.unlock();
	}

	private void updateRecursivly(Info approved, Set<Info> visited) {
		if (approved != null && !visited.contains(approved)) {
			approved.incrementApprovers();
			visited.add(approved);
			Consumer<Info> run = update -> updateRecursivly(update, visited);
			run.accept(approved.getTrunk());
			run.accept(approved.getBranch());
		}
	}

	private void removeOldApprovers() {
		log.info("Clean up txs...");
		milestones.keySet().stream().filter(i -> milestones.get(i).isEmpty()).forEach(milestones::remove);
		int toMarkIndex = latestMilestone - maxDepth;
		log.info("Mark milestone {}", toMarkIndex);
		Set<Info> toMark = milestones.get(toMarkIndex);
		if (toMark != null) {
			log.info("Mark {} txs.", toMark.size());
			toMark.forEach(tx -> {
				tx.setBranch(null);
				tx.setTrunk(null);
			});
		}
		int toDeleteIndex = toMarkIndex - 1;
		log.info("Delete milestone {}", toDeleteIndex);
		Set<Info> toDelete = milestones.get(toDeleteIndex);
		if (toDelete != null) {
			log.info("Delete {} txs.", toDelete.size());
			toDelete.stream().map(Info::getHash).forEach(tx -> {
				txs.remove(tx);
				tails.remove(tx);
				consistent.remove(tx);
			});
			milestones.remove(toDeleteIndex);
		}
	}
}
