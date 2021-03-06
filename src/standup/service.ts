import { IMessageConsumer, Response, Message, Robot} from '../protocol';
import * as Report from './report';
import * as Channel from './channel';
import * as moment from 'moment';
import * as mongoose from 'mongoose';
import { IChannel, IReport } from './model';


export class StandupService implements IMessageConsumer {
  public static robot:Robot;

  constructor(mongoConnectionString:string) {
    mongoose.connect(mongoConnectionString);
    let db = mongoose.connection;
    db.on('error', console.error.bind(console, 'connection error:'));
    db.once('open', function () {
      console.log('connected to db');
      // we're connected!
    });
  }

  receive(response: Response) {
    if (!response.message.room) {
      response.send('Get a room!!');
    }
    else if (response.message.body.trim().length < 1) {
      this.printStandupReport(response);
    } else {//save a report
      this.saveChannelIfNotExists(response)
        .then((channel) => {
          return Promise.all([this.saveStandupReport(response),
          this.addUserToChannelTeamIfNeeded(channel, response.message.userId)]);
        })
        .catch(error => {
          console.log(error);
        });
    }
  }

  private printStandupReport(response: Response): void {
    Channel.findOne({ id: response.message.room }).then(
      channel => {
        if (channel) {
          let hour = moment().startOf('hour');
          let searchStart = hour.subtract(24, 'hour');
          Report.find({ "channel": channel.id, "created_at": { $gt: searchStart.toDate() } }).then(
            reports => {
              let reportMesage: string = '';
              let user = null;
              if (reports && reports[0]) {
                user = StandupService.robot.getUserForId(reports[0].user);
              }
              reports.forEach(report => {
                let userName = user.realName || user.name;
                let body = report.text;
                let time = moment().to(report.created_at);
                reportMesage += `#### ${userName} reported ${time}\n ${body}\n`;
              });
              StandupService.robot.messageRoom(user.name, reportMesage);
            }
          );
        }
      }
    ).catch(error => {
      console.log(error);
    });

  };

  private saveChannelIfNotExists(response: Response): Promise<IChannel> {
    return new Promise((resolve, reject) => {
      Channel.findOne({ id: response.message.room }, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        if (!channel) {
          channel = new Channel();
          channel.id = response.message.room;
          channel.team.push(response.message.userId);
          return channel.save();
        }
        resolve(channel);
      }
      );

    });

  }

  private addUserToChannelTeamIfNeeded(channel: IChannel, userId: string): Promise<void> {
    if (channel.team.indexOf(userId) > -1) {
      return Promise.resolve();
    } else {
      channel.team.push(userId);
      return new Promise<void>((resolve, reject) => {
        Channel.update({ id: channel.id }, { $set: { team: channel.team } }, (err, raw) => {
          if (err) {
            reject(err);
          }
        });
      });
    }
  }

  private saveStandupReport(response: Response): Promise<IReport> {
    let channelID = response.message.room;
    let message: Message = response.message;
    let report = new Report();
    report.channel = channelID;
    report.text = message.body.trim();
    report.user = message.userId;
    report.created_at = new Date();
    return report.save();
  }
}
