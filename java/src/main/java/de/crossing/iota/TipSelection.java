package de.crossing.iota;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author soowe
 *
 */
public class TipSelection {
	private TangleListener tangle;
	private double alpha;

	private Logger log = LoggerFactory.getLogger(TipSelection.class);

	public TipSelection(TangleListener tangle, double alpha) {
		this.tangle = tangle;
		this.alpha = alpha;
	}

	public List<String> getTips(int depth) {
		try {
			tangle.getLock().lock();
			int entryMilestone = tangle.getLatestMilestone() - depth;
			Set<Info> milestone = tangle.getMilestones().get(entryMilestone);
			if (milestone != null && milestone.size() > 0) {
				Set<String> inconsistentTxs = new HashSet<>();
	
				Supplier<List<String>> findTips = new Supplier<List<String>>() {
					@Override
					public List<String> get() {
						if (milestone.isEmpty()) {
							throw new Error("No consistent entry points available.");
						}
						List<Info> tips = Arrays.asList(new Info[] { randomWalk(milestone, depth, inconsistentTxs),
								randomWalk(milestone, depth, inconsistentTxs) });
						if (tips.stream().filter((t) -> t != null).toArray().length == 2) {
							if (tangle.areTxsConsistent(
									tips.stream().map((t) -> t.getHash()).toArray(length -> new String[length]))) {
								List<String> hashes = tips.stream().map((t) -> t.getHash()).collect(Collectors.toList());
								return hashes;
							} else {
								tips.forEach(t -> inconsistentTxs.add(t.getHash()));
								log.debug("Selected tips ar not consistent. Try again.");
								milestone.removeAll(milestone.stream().filter(t -> inconsistentTxs.contains(t.getHash()))
										.collect(Collectors.toSet()));
								return get();
							}
						} else {
							throw new IllegalStateException("No consistent tips could be found.");
						}
					}
				};
				return findTips.get();
			} else {
				throw new IllegalArgumentException("Tangle with this depth is not present.");
			}
		} finally {
			tangle.getLock().unlock();
		}
	}

	private Info randomWalk(Set<Info> entries, int depth, Set<String> inconsistentTxs) {
		Set<Info> validEntries = entries.stream().filter((e) -> !inconsistentTxs.contains(e.getHash()))
				.collect(Collectors.toSet());
		if (validEntries.size() == 0) {
			return null;
		} else {
			Result res = select(validEntries, inconsistentTxs, (depth + 1) * 4);
			if (res.tx.getApprovers() == 0) {
				log.debug("Traversed {} consistent txs for random walk", res.traversed.size());
				return res.tx;
			} else {
				log.warn("Can't find consistent tip.");
				return null;
			}
		}
	}

	private Result select(Set<Info> validEntries, Set<String> inconsistentTxs, int verifyBatchSize) {
		Random r = new Random();
		int index = r.nextInt(validEntries.size());
		Info entryPoint = new ArrayList<>(validEntries).get(index);
		Set<String> traversed = new HashSet<>();

		Info tx = entryPoint;
		Info lastValid = entryPoint;
		List<String> toVerify = new ArrayList<>();
		List<Info> approvers = tx.getDirectApprovers().stream().filter((e) -> !inconsistentTxs.contains(e.getHash()))
				.collect(Collectors.toList());

		while (approvers.size() > 0) {
			traversed.add(tx.getHash());
			List<Integer> ratings = approvers.stream().map((a) -> a.getApprovers() + 1).collect(Collectors.toList());
			int maxRating = ratings.stream().max(Integer::compareTo).orElse(0);
			List<Double> weights = ratings.stream().map((w) -> w - maxRating).map((w) -> Math.exp(alpha * w))
					.collect(Collectors.toList());

			double weightSum = weights.stream().reduce(0d, Double::sum);
			double target = r.nextDouble() * weightSum;

			int approverIndex;
			for (approverIndex = 0; approverIndex < weights.size() - 1 && target > 0; approverIndex++) {
				target -= weights.get(approverIndex);
			}

			Info approver = approvers.get(approverIndex);
			
			Info tail = tangle.getTails().get(approver.getBundle());

			if (tail != null) {
				tx = tail;
				toVerify.add(tx.getHash());
				if (toVerify.size() >= verifyBatchSize) {
					if (tangle.areTxsConsistent(toVerify.toArray(new String[toVerify.size()]))) {
						lastValid = tx;
					} else {
						log.debug("Traversed txs aren't consistent. Go back {} steps.", verifyBatchSize + 1);
						toVerify.forEach((t) -> {
							inconsistentTxs.add(t);
							traversed.remove(t);
						});
						inconsistentTxs.add(approver.getHash());
						tx = lastValid;
					}
					toVerify.clear();
				}
				approvers = tx.getDirectApprovers().stream().filter((e) -> !inconsistentTxs.contains(e.getHash()))
						.collect(Collectors.toList());
			} else {
				log.warn("Tail of {} is not present", tx.getHash());
				approvers.remove(approverIndex);
			}
		}
		return new Result(tx, traversed);
	}

	private class Result {
		private Info tx;
		private Set<String> traversed;

		public Result(Info tx, Set<String> traversed) {
			this.tx = tx;
			this.traversed = traversed;
		}
	}
}
