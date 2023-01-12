import express from "express";
import cors from "cors";
import Joi from "joi";
import dayjs from "dayjs";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();
// Create a new MongoClient
const client = new MongoClient(process.env.DATABASE_URL);
let db;

client
	.connect()
	.then(() => {
		db = client.db("chat");
		console.log("Connected to Client");
	})
	.catch((err) => {
		console.log(err);
	});

async function addMessage(from, to, text, type, time) {
	try {
		await client.db("admin").command({ ping: 1 });
		const db = client.db("chat");
		const messages = db.collection("messages");
		const message = { from, to, text, type, time };
		await messages.insertOne(message);
	} catch {
		console.log("Error adding message");
	}
}

async function checkConflict(name) {
	let result;
	try {
		await client.db("admin").command({ ping: 1 });
		const db = client.db("chat");
		const participants = db.collection("participants");
		result = await participants.findOne({ name });
	} catch {
		console.log("Error checking conflict");
		result = false;
	} finally {
		return result;
	}
}

async function findInactiveParticipants(time) {
	let result;
	try {
		await client.db("admin").command({ ping: 1 });
		const db = client.db("chat");
		const participants = db.collection("participants");
		result = await participants
			.find({ lastStatus: { $lt: time } })
			.toArray();
	} catch {
		console.log("Error finding participants");
		result = [];
	} finally {
		return result;
	}
}

async function removeParticipant(name) {
	try {
		await client.db("admin").command({ ping: 1 });
		const db = client.db("chat");
		const participants = db.collection("participants");
		await participants.deleteOne({ name });
	} catch {
		console.log("Error removing participants");
	}
}

async function addParticipant(name) {
	try {
		await client.db("admin").command({ ping: 1 });
		const db = client.db("chat");
		const participants = db.collection("participants");
		const participant = { name: name, lastStatus: Date.now() };
		await participants.insertOne(participant);
	} catch {
		console.log("Error adding participant");
	}
}

const participantSchema = Joi.object({
	name: Joi.string().min(1).required(),
});

const messageSchema = Joi.object({
	to: Joi.string().min(1).required(),
	text: Joi.string().min(1).required(),
	type: Joi.string().valid("message", "private_message").required(),
});

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_, res) => {
	const date = dayjs().format("DD/MM/YYYY HH:mm:ss");
	res.send("Hello World =>" + date);
});

app.get("/messages", async (req, res) => {
	const { limit } = req.query;
	const { user } = req.headers;
	const messages = await db
		.collection("messages")
		.find({
			$or: [
				{ type: "message" },
				{ type: "status" },
				{
					$and: [
						{ type: "private_message" },
						{ $or: [{ to: user }, { from: user }] },
					],
				},
			],
		})
		.sort({ $natural: -1 })
		?.limit(parseInt(limit))
		.toArray();
	res.send(messages.reverse());
});

app.post("/status", (req, res) => {
	const { user } = req.headers;
	const participant = { name: user, lastStatus: Date.now() };
	db.collection("participants").updateOne(
		{ name: user },
		{ $set: participant }
	);
	res.sendStatus(200);
});

app.post("/messages", async (req, res) => {
	const { user } = req.headers;
	const findUser = await db
		.collection("participants")
		.findOne({ name: user });
	const message = req.body;
	const { error } = messageSchema.validate(message);
	if (error || !findUser) {
		res.status(422).send(error);
		return;
	}
	const time = dayjs().format("HH:mm:ss");
	const { to, text, type } = message;
	await addMessage(user, to, text, type, time);
	res.sendStatus(201);
});

app.get("/participants", (_, res) => {
	db.collection("participants")
		.find()
		.toArray()
		.then((result) => {
			res.status(200).send(result);
		});
});

app.post("/participants", async (req, res) => {
	const participant = req.body;

	const { error } = participantSchema.validate(participant);
	if (error) {
		res.sendStatus(422);
		return;
	}
	const conflict = await checkConflict(participant.name);
	if (conflict) {
		res.sendStatus(409);
	} else {
		const time = dayjs().format("HH:mm:ss");
		await addParticipant(participant.name);
		await addMessage(
			participant.name,
			"Todos",
			"entra na sala...",
			"status",
			time
		);
		res.sendStatus(201);
	}
});

function removeInactive() {
	setInterval(async () => {
		let participants;
		await findInactiveParticipants(Date.now() - 10000).then((result) => {
			participants = result.map((participant) => participant.name);
		});
		const promises = participants.map(async (participant) => {
			const time = dayjs().format("HH:mm:ss");
			await removeParticipant(participant);
			await addMessage(
				participant,
				"Todos",
				"sai da sala...",
				"status",
				time
			);
		});
		await Promise.all(promises);
		//Maybe remove this console log once development is done
		console.log(`Removed participants: ${participants}`);
	}, 15000);
}

const PORT = 5000;
app.listen(PORT, () => {
	console.log(`Server started on port ${PORT}`);
	removeInactive();
});
