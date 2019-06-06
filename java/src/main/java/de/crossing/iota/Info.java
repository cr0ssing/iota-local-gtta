/**
 * 
 */
package de.crossing.iota;

import java.util.Set;
import java.util.concurrent.ConcurrentSkipListSet;

/**
 * @author soowe
 *
 */
public class Info implements Comparable<Info> {
	private final String hash;
	private final String bundle;
	private Info trunk;
	private Info branch;
	private Set<Info> directApprovers = new ConcurrentSkipListSet<Info>();
	private int approvers = 0;

	public Info(String hash, String bundle, Info trunk, Info branch) {
		this.hash = hash;
		this.bundle = bundle;
		this.trunk = trunk;
		this.branch = branch;
	}

	public synchronized void incrementApprovers() {
		approvers++;
	}

	public int getApprovers() {
		return approvers;
	}

	public Set<Info> getDirectApprovers() {
		return directApprovers;
	}

	public Info getTrunk() {
		return trunk;
	}

	public Info getBranch() {
		return branch;
	}

	public String getBundle() {
		return bundle;
	}

	public void setTrunk(Info trunk) {
		this.trunk = trunk;
	}

	public void setBranch(Info branch) {
		this.branch = branch;
	}

	public String getHash() {
		return hash;
	}

	public int hashCode() {
		return this.hash.hashCode();
	}

	@Override
	public int compareTo(Info o) {
		if (o == null) {
			return 1;
		}
		return this.hash.compareTo(o.getHash());
	}

	@Override
	public String toString() {
		return "Info [" + (hash != null ? "hash=" + hash + ", " : "") + "approvers=" + approvers + ", "
				+ (trunk != null ? "trunk=" + trunk.getHash() + ", " : "")
				+ (branch != null ? "branch=" + branch.getHash() + ", " : "")
				+ (bundle != null ? "bundle=" + bundle : "") + "]";
	}
}
