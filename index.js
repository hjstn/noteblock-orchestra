// Constants

// Minecraft "ok" pitch range: 0.1 to 6

const PITCH_MIN = 0.1;
const PITCH_MAX = 6;

const INSTR_ROUND_OFF = 5;
const TIMER_TAG = 'music';
const TICK_RATE = 20;

// Modules

const fs = require('fs');

const uuid = require('uuid');
const AdmZip = require('adm-zip');

// Arguments

const argv = require('yargs').options({
    'midi': {
        description: 'Input MIDI.',
        required: true,
        alias: 'i'
    },
    'name': {
        description: 'Name.',
        required: true,
        alias: 'n'
    }
}).argv;

// Template file

const templateFile = new AdmZip('./template.mcpack');

// Music helpers

let repitched = 0;

const instruments = {};

for (let [noteblock, midiList] of Object.entries(require('./model/instruments'))) {
    midiList.forEach(midi => instruments[midi] = noteblock);
}

function midiToPitch(midi) {
    // Expect midi between 0 and 127

    // Below octave 3, repitch up
    if (midi < 36) {
        midi = (midi % 12) + 36;
        repitched++;
    }

    // Above octave 96, repitch down
    if (midi > 96) {
        midi = 84 + (midi * 12);
        repitched++;
    }

    return (0.5 * Math.pow(2, (-54 + midi)/12)).toFixed(INSTR_ROUND_OFF);
}

function noteToCommand(note, instrument) {
    const tick = Math.round(note.time * TICK_RATE);
    return `playsound ${instrument} @a[scores={${TIMER_TAG}=${tick}}] 0 25600 0 ${note.volume} ${note.pitch} ${note.volume}`;
}

// Midi parsing and command generation

const midiFile = fs.readFileSync(argv.midi);

const { Midi } = require('@tonejs/midi');

const midi = new Midi(midiFile);

const possibleTracks = midi.tracks.filter(track => track.instrument.number in instruments);

const commands = possibleTracks.map(track => {
    track.minecraft = {};

    track.minecraft.instrument = instruments[track.instrument.number]
    track.minecraft.notes = track.notes.map(note => ({
        time: note.time.toFixed(INSTR_ROUND_OFF),
        volume: note.velocity.toFixed(INSTR_ROUND_OFF),
        pitch: midiToPitch(note.midi)
    }));

    track.minecraft.commands = track.minecraft.notes.map(note => {
        return noteToCommand(note, track.minecraft.instrument);
    });

    return track;
}).reduce((allCommands, track) => {
    allCommands.push(...track.minecraft.commands);

    return allCommands;
}, []);

const finalTick = Math.round(midi.duration * TICK_RATE);

commands.push(`scoreboard players reset @a[scores={music=${finalTick}..}] music`);

// Split files

const outputFunctions = [];

while (commands.length > 0) {
    const commandSegment = commands.splice(0, 10000);

    outputFunctions.push(commandSegment);
};

outputFunctions.forEach((outputFunction, outputIndex) => {
    templateFile.addFile(`Template/functions/NBO_${argv.name}/${outputIndex + 1}.mcfunction`, outputFunction.join('\n'));
});

console.log(`Duration: ${finalTick} ticks. ${outputFunctions.length} files. ${repitched} notes repitched. ${midi.tracks.length - possibleTracks.length} tracks skipped.`);

// Patch manifest

const manifest = JSON.parse(templateFile.readAsText('Template/manifest.json'));

manifest.header.name = argv.name;
manifest.header.uuid = uuid.v4();
manifest.modules.forEach(module => module.uuid = uuid.v4());

templateFile.updateFile('Template/manifest.json', JSON.stringify(manifest));

// Save file

templateFile.writeZip(`output/${argv.name}.mcpack`);