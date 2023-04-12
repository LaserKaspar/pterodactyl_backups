const fetch = require('node-fetch');
require('dotenv').config();
const util = require('util');
const https = require('https');
const fs = require('fs');

async function getNodes() {
    const resp = await fetch('https://pterodactyl.roisplitt.at/api/application/nodes/', {
        headers: {"Authorization": 'Bearer ' + process.env.ADMINUSER_API_KEY}
    });
    const json = await resp.json();

    nodes = {}

    json.data.forEach(node => {
        nodes[node.attributes.id] = {};
    });

    return nodes;
}

async function checkIfNodeIsUp(nodeid) {
    const resp = await fetch('https://pterodactyl.roisplitt.at/api/application/nodes/' + nodeid, {
        headers: {"Authorization": 'Bearer ' + process.env.ADMINUSER_API_KEY}
    });
    const json = await resp.json();

    const url = json.attributes.scheme + "://" + json.attributes.fqdn + ":" + json.attributes.daemon_listen;
    console.log("Check if Node " + nodeid + " (" + url + ") is online.");
    const status = await fetch(url).then(resp => true).catch(err => false);
    if(status)
        console.log("Node " + nodeid + " is up");
    else
        console.log("Node " + nodeid + " is down");

    return status;
}

async function getServers(syncInfo) {
    const resp = await fetch('https://pterodactyl.roisplitt.at/api/application/servers', {
        headers: {"Authorization": 'Bearer ' + process.env.APPLICATION_API_KEY}
    });
    const json = await resp.json();

    for(const server of json.data) {
        const attributes = server.attributes;
        const nodeid = attributes.node;

        if(syncInfo.nodes[nodeid].online) {
            syncInfo.nodes[nodeid].servers[attributes.identifier] = {name: attributes.name, identifier: attributes.identifier, backupLimit: attributes.feature_limits.backups, suspended: attributes.suspended};
        }
    }
}

async function iterateBackups(syncInfo) {
    for (const node in syncInfo.nodes) {
        if(!syncInfo.nodes[node].online) continue;

        for(const server in syncInfo.nodes[node].servers) {
            const backups =  await getBackupForServer(syncInfo.nodes[node].servers[server]);
            syncInfo.nodes[node].servers[server].backups = backups;
            if(backups)
                syncInfo.nodes[node].servers[server].backupcount = backups.length;
        }
    }
}

async function getBackupForServer(server) {
    if(server.suspended) {
        console.log("Server suspended: " + server.name);
        return;
    }

    if(server.backupLimit == 0) {
        console.log("No backups: " + server.name);
        return;
    }

    const resp = await fetch('https://pterodactyl.roisplitt.at/api/client/servers/' + server.identifier + '/backups', {
        headers: {"Authorization": 'Bearer ' + process.env.ADMINUSER_API_KEY}
    });
    console.log("Get backups for: " + server.name);
    const backups = (await resp.json()).data;

    return backups.map(backup => {
        return {
            uuid: backup.attributes.uuid, 
            name: backup.attributes.name, 
            success: backup.attributes.is_successful, 
            date: backup.attributes.created_at
        }
    });
}

async function downloadBackup(nodeid, serverid, backup) {
    const resp = await fetch('https://pterodactyl.roisplitt.at/api/client/servers/' + serverid + '/backups/' + backup.uuid + '/download', {
        headers: {"Authorization": 'Bearer ' + process.env.ADMINUSER_API_KEY}
    });

    const downloadURL = (await resp.json()).attributes.url;
    console.log("Starting download of backup " + backup.uuid + " of server " + serverid + " on Node" + nodeid);

    return new Promise(async (resolve, reject) => {
        // Download to syncs/downloads/node-x/server-x/backup.tar.gz
        const path = "syncs/downloads/node-" + nodeid + "/server-" + serverid + "/";
        await fs.mkdirSync(path, { recursive: true });
        const filePath = path + backup.uuid + ".tar.gz"

        if(fs.existsSync(filePath)) {
            console.log("Backup already exists but was not marked as downloaded. Please verify integrity of this backup.");
            resolve();
            return;
        }

        if(fs.existsSync(filePath + ".download")) {
            console.log("Partial backup already exists. Redownloading.");
            fs.unlinkSync(filePath + ".download");
        }

        const file = fs.createWriteStream(filePath + ".download");
        https.get(downloadURL, function(response) {
            response.pipe(file);
    
            // after download completed close filestream
            file.on("finish", () => {
                file.close();
                console.log("Download Completed");
                fs.renameSync(filePath + ".download", filePath);
                resolve();
            });
        }).on('error', function(err) { // Handle errors
            fs.unlink(filePath); // Delete the file async. (But we don't check the result)
            reject(err);
        });;
    });
}

async function downloadNewBackups(syncInfo) {

    console.log("Start downloading Backups");
    let total = 0;

    // Download new backups in paralell for each node
    const promises = [];
    for (const nodeid in syncInfo.nodes) {
        promises.push(new Promise(async (resolve, reject) => {
            if(!syncInfo.nodes[nodeid].online) return;

            for(const serverid in syncInfo.nodes[nodeid].servers) {
                const backups = syncInfo.nodes[nodeid].servers[serverid].backups
                for(const backupindex in backups) {
                    const backup = backups[backupindex]

                    if(syncInfo.nodes[nodeid].lastSync && new Date(syncInfo.nodes[nodeid].lastSync) > new Date()) {
                        console.log("Backup was already synced");
                        continue;
                    }
                    
                    if(!backup.success) continue;

                    console.log("Syncing backup");
                    
                    await downloadBackup(nodeid, serverid, backup).catch(err => reject(err));

                    total++;
                    resolve();
                }
            }
        }));
        await Promise.all(promises);
        
        syncInfo.nodes[nodeid].lastSync = new Date().toJSON();
    }
    console.log("Total Backups: " + total);
}

async function startDownload() {
    let oldSyncInfo = {};

    const logPath = "syncs/logs/";
    await fs.mkdirSync(logPath, { recursive: true });
    const latestSyncPath = fs.readdirSync(logPath)[logPath.length - 1];
    if(latestSyncPath)
        oldSyncInfo = require(logPath + latestSyncPath.name);

    const syncInfo = {lastSync: new Date().toJSON(), nodes: {}};

    syncInfo.nodes = await getNodes();

    console.log(syncInfo.nodes)

    // Check Status of nodes in paralell
    const promises = [];
    for (const id in syncInfo.nodes) {
        promises.push(new Promise(async (resolve, reject) => {
            if (await checkIfNodeIsUp(id)) {
                syncInfo.nodes[id].online = true;
                syncInfo.nodes[id].servers = {};
            }
            else {
                if(oldSyncInfo && oldSyncInfo.nodes && oldSyncInfo.nodes[id]) {
                    // used cached info
                    syncInfo.nodes[id].lastSync = oldSyncInfo.nodes[id].lastSync;
                    syncInfo.nodes[id].online = false;
                    syncInfo.nodes[id].servers = oldSyncInfo.nodes[id].servers;
                }
                else {
                    // node was never seen before
                    syncInfo.nodes[id].lastSync = undefined;
                    syncInfo.nodes[id].online = false;
                    syncInfo.nodes[id].servers = {};
                }
            }
            resolve();
        }));
    }
    await Promise.all(promises);
    
    // Get servers of online nodes
    await getServers(syncInfo);

    // Get backups for all servers
    // Store backup count
    // Store backup name, backup uuid, backup date

    await iterateBackups(syncInfo);

    console.log(util.inspect(syncInfo, true, null, true));

    await downloadNewBackups(syncInfo);
    
    let data = JSON.stringify(syncInfo);
    fs.writeFileSync('syncs/logs/syncinfo-' + new Date().toJSON() + '.json', data);
}

startDownload();