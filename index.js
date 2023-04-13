const fetch = require('node-fetch');
require('dotenv').config();
const util = require('util');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');

async function getNodes() {
    const resp = await fetch(process.env.PTERO_BASE_URL + '/api/application/nodes/', {
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
    const resp = await fetch(process.env.PTERO_BASE_URL + '/api/application/nodes/' + nodeid, {
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
    const resp = await fetch(process.env.PTERO_BASE_URL + '/api/application/servers', {
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

    const resp = await fetch(process.env.PTERO_BASE_URL + '/api/client/servers/' + server.identifier + '/backups', {
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
    const resp = await fetch(process.env.PTERO_BASE_URL + '/api/client/servers/' + serverid + '/backups/' + backup.uuid + '/download', {
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

        const url = new URL(downloadURL);
        let protocol;
        if (url.protocol === 'https:') {
            protocol = https;
        } else if (url.protocol === 'http:') {
            protocol = http;
        } else {
            throw new Error(`Unsupported protocol: ${urlObj.protocol}`);
        }
        protocol.get(url, function(response) {
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

async function downloadNewBackups(syncInfo, oldSyncInfo) {

    console.log("Start downloading Backups");
    let total = 0;

    // Download new backups in paralell for each node
    const promises = [];
    for (const nodeid in syncInfo.nodes) {
        // Sync node
        promises.push(new Promise(async (resolve, reject) => {
            if(!syncInfo.nodes[nodeid].online) {
                resolve("Node is offline");
                return;
            }

            for(const serverid in syncInfo.nodes[nodeid].servers) {
                const backups = syncInfo.nodes[nodeid].servers[serverid].backups
                for(const backupindex in backups) {
                    const backup = backups[backupindex];

                    // There is a last sync
                    if(oldSyncInfo && oldSyncInfo != {}) {
                        console.log("Last sync detected.");
                        // Node was present in last sync
                        if(oldSyncInfo.nodes && oldSyncInfo.nodes[nodeid] && oldSyncInfo.nodes[nodeid].online) {
                            console.log("Node with this backup was present & online in last sync.");
                            // Last sync was after backup creation
                            if(new Date(oldSyncInfo.lastSync) > new Date(backup.date)) {
                                console.log("Backup should already be synced.");
                                continue;
                            }
                        }
                    }
                    
                    if(!backup.success) {
                        continue;
                    } 

                    console.log("Syncing backup");
                    
                    await downloadBackup(nodeid, serverid, backup).catch(err => reject(err));

                    total++;
                }
            }

            resolve();
        }));
        await Promise.all(promises);
        
        syncInfo.nodes[nodeid].lastSync = new Date().toJSON();
    }
    console.log("Downloaded Backups: " + total);
}

function isBackupInBackupList(uuid, backupList) {
    for (let index = 0; index < backupList.length; index++) {
        const backup = backupList[index];
        if(backup.uuid == uuid)
            return true;
    }
    return false;
}

async function deleteOldBackups(syncInfo) {
    // loop over file structure and fild old backups delete them if they are older than a week
    console.log("Checking for stray backups");
    
    fs.readdir("syncs/downloads", (err, files) => {
        files.forEach(file => {
            const nodeid = file.replace("node-", "");
            fs.readdir("syncs/downloads/node-" + nodeid, (err, files) => {
                files.forEach(file => {
                    const serverid = file.replace("server-", "");
                    const serverPath = "syncs/downloads/node-" + nodeid + "/server-" + serverid + "/";
                    console.log("Checking backups for server: " + serverid);
                    fs.readdir(serverPath, (err, files) => {
                        files.forEach(file => { 
                            const backupuuid = file.replace(".tar.gz", "").replace(".download", "");

                            // Node Exists & is online
                            if(syncInfo.nodes[nodeid] && syncInfo.nodes[nodeid].online) {
                                server = syncInfo.nodes[nodeid].servers[serverid];

                                // server and backups exist
                                if(server && (isBackupInBackupList(backupuuid, server.backups) || server.suspended)) {
                                    // keep
                                    console.log("Keeping backup: " + backupuuid);
                                }
                                else {
                                    console.log("Stray backup detected: " + backupuuid);
                                    // delete if older than a week
                                    var stats = fs.statSync(serverPath + file);
                                    var lastModified = new Date(stats.mtime);
                                    if((new Date() - lastModified) < (60 * 60 * 1000) * 24 * 7) {
                                        console.log("Stray backup is not older than a week. Keeping it in case of user error.");
                                    }
                                    else {
                                        console.log("Deleting Stray backup.");
                                        fs.unlinkSync(serverPath + file);
                                    }
                                }
                            }
                            else {
                                console.log("Node is offline, or was deleted. Please cleanup node-" + nodeid + " manually if the node was intentionally deleted.");
                            }
                        });
                    });
                });
            });
        });
    });

}

async function getSyncInfo() {
    let oldSyncInfo = {};

    const logPath = "syncs/logs/";
    await fs.mkdirSync(logPath, { recursive: true });
    const latestSyncDir = fs.readdirSync(logPath);
    const latestSyncItem = latestSyncDir[latestSyncDir.length - 1];
    if(latestSyncItem)
        oldSyncInfo = JSON.parse(fs.readFileSync(logPath + latestSyncItem));

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

    return {syncInfo: syncInfo, oldSyncInfo: oldSyncInfo};
}

async function startDownload(syncInfo, oldSyncInfo) {
    // Get servers of online nodes
    await getServers(syncInfo);

    // Get backups for all servers

    await iterateBackups(syncInfo);

    // console.log(util.inspect(syncInfo, true, null, true));
    // console.log(util.inspect(oldSyncInfo, true, null, true));

    // Download everything
    await downloadNewBackups(syncInfo, oldSyncInfo);
    
    let data = JSON.stringify(syncInfo);
    fs.writeFileSync('syncs/logs/syncinfo-' + formatDate(new Date()) + '.json', data);
}

function formatDate(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');      // "+ 1" becouse the 1st month is 0
    var day = String(date.getDate()).padStart(2, '0');
    var hour = String(date.getHours()).padStart(2, '0');
    var minutes = String(date.getMinutes()).padStart(2, '0');
    var secconds = String(date.getSeconds()).padStart(2, '0');

    return year + "-" + month + '-' + day + '_'+ hour+ '-'+ minutes+ '-'+ secconds;
}

async function done() {
    await fetch(process.env.DONE_GET_URL);
}

async function init() {
    const { syncInfo, oldSyncInfo } = await getSyncInfo();
    await startDownload(syncInfo, oldSyncInfo);
    console.log("Download done.");
    await deleteOldBackups(syncInfo);
    await done();
}

init();