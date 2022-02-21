import {
    HindenburgPlugin,
    WorkerPlugin,
    EventListener,
    GameSettings,
    Connection,
    WorkerBeforeJoinEvent,
    RoomBeforeCreateEvent,
    Code2Int
} from "@skeldjs/hindenburg";

const cancelCodeInt = Code2Int("CANCEL");

export interface CustomGameCodeCreation {
    gameSettings: GameSettings;
    client: Connection;
    expiryTimestamp: number;
}

@HindenburgPlugin("hbplugin-custom-gamecode", "1.0.0", "none")
export class CustomGamecodePlugin extends WorkerPlugin {
    protected customCreations: Map<string, CustomGameCodeCreation> = new Map;
    protected cleanUpInterval?: NodeJS.Timeout;

    onPluginLoad() {
        this.cleanUpInterval = setInterval(() => {
            for (const [ key, customCreation ] of this.customCreations) {
                if (this.isCreationExpired(customCreation)) {
                    this.customCreations.delete(key);
                    this.logger.info("Custom game code creation expired: %s", customCreation.client);
                }
            }
        }, 60 * 1000);
    }

    onPluginUnload() {
        if (this.cleanUpInterval) {
            clearInterval(this.cleanUpInterval);
        }
    }

    isCreationExpired(creation: CustomGameCodeCreation) {
        return Date.now() >= creation.expiryTimestamp;
    }

    getCustomCreation(client: Connection) {
        return client.remoteInfo.address + ":" +
            client.username + ":" +
            client.clientVersion.toString() + ":" +
            client.platform.platformTag + ":" +
            client.language +
            [...client.mods].map(mod => ":" + mod[1].modId + ":" + mod[1].modVersion).join("");
    }

    setCustomCreation(client: Connection) {
        const key = this.getCustomCreation(client);
        const creation = this.customCreations.get(key);

        if (!creation)
            return undefined;

        if (this.isCreationExpired(creation)) {
            this.customCreations.delete(key);
            return undefined;
        }

        return creation.gameSettings;
    }

    setCustomGameCodeSettings(client: Connection, gameSettings: GameSettings) {
        return this.customCreations.set(this.getCustomCreation(client), {
            gameSettings: gameSettings,
            client,
            expiryTimestamp: Date.now() + (60 * 1000)
        });
    }

    @EventListener("worker.beforejoin")
    async onWorkerBeforeJoin(ev: WorkerBeforeJoinEvent) {
        const customGameCode = this.setCustomCreation(ev.client);

        if (customGameCode) {
            if (ev.gameCode === cancelCodeInt) {
                ev.client.disconnect("Canceled game creation");
                this.logger.info("%s canceled custom game code room creation.", ev.client);
                ev.cancel();
                return;
            }

            const existingRoom = this.worker.rooms.get(ev.gameCode);
            if (existingRoom) {
                ev.client.disconnect("A room already exists with that game code, try another, or enter 'CANCEL' to stop.");
                this.logger.info("%s tried to create a room with a used game code.", ev.client);
                ev.cancel();
                return;
            }

            const createdRoom = await this.worker.createRoom(ev.gameCode, customGameCode);
            this.logger.info("%s created room: ", createdRoom);
            ev.setRoom(createdRoom);
        }
    }

    @EventListener("room.beforecreate")
    async onWorkerBeforeCreate(ev: RoomBeforeCreateEvent) {
        this.setCustomGameCodeSettings(ev.client, ev.gameOptions);
        ev.cancel();
        ev.client.disconnect("Enter a custom game code in the join game section, or enter 'CANCEL' to stop.");
        this.logger.info("%s creating new room, waiting for game code", ev.client);
    }
}
